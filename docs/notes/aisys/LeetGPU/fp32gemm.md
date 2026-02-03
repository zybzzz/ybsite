# FP32 GEMM

```cpp
#include <cuda.h>
#include <cuda_runtime.h>
#include <stdint.h>

// NOTE:
// ptxas errors like "mbarrier not known" happen when compiling for a target that
// does not support SM90A, or when SM90A PTX is emitted for a non-SM90A target.
// Always compile with: nvcc -arch=sm_90a (or --generate-code arch=compute_90a,code=sm_90a)
// and guard SM90A-only PTX with __CUDA_ARCH__ checks.

#if defined(__CUDA_ARCH__) && (__CUDA_ARCH__ >= 900) && \
    (defined(__CUDA_ARCH_FEAT_SM90A) || defined(__CUDA_ARCH_FEAT_SM90_ALL))
#define SM90A_ENABLED 1
#else
#define SM90A_ENABLED 0
#endif

constexpr int kPerfM = 8192;
constexpr int kPerfN = 6144;
constexpr int kPerfK = 4096;

constexpr int kTileM = 64;
constexpr int kTileN = 128;
constexpr int kTileK = 32;
constexpr int kStages = 3;

constexpr int kSwizzle128B = 2;

constexpr size_t align_up(size_t value, size_t alignment) {
    return (value + alignment - 1) & ~(alignment - 1);
}

constexpr size_t smem_stage_bytes() {
    return align_up(kTileM * kTileK * sizeof(float) + kTileK * kTileN * sizeof(float), 128);
}

constexpr size_t smem_output_bytes() {
    return align_up(kTileM * kTileN * sizeof(float), 128);
}

constexpr size_t smem_barrier_bytes() {
    return align_up(sizeof(uint64_t) * kStages * 2, 128);
}

constexpr size_t smem_bytes_total() {
    return smem_barrier_bytes() + smem_stage_bytes() * kStages + smem_output_bytes();
}

__device__ __constant__ CUtensorMap g_tmaA;
__device__ __constant__ CUtensorMap g_tmaB;

__device__ __forceinline__ uint32_t smem_addr(const void* ptr) {
#if defined(__CUDA_ARCH__)
    return static_cast<uint32_t>(__cvta_generic_to_shared(ptr));
#else
    return 0;
#endif
}

__device__ __forceinline__ uint64_t make_wgmma_desc(const void* smem_ptr, int ld, int swizzle) {
#if SM90A_ENABLED
    uint32_t addr = smem_addr(smem_ptr);
    uint64_t desc = static_cast<uint64_t>(addr) >> 4;
    desc |= (static_cast<uint64_t>(ld >> 4) << 16);
    desc |= (static_cast<uint64_t>(swizzle) << 62);
    return desc;
#else
    (void)smem_ptr;
    (void)ld;
    (void)swizzle;
    return 0;
#endif
}

__device__ __forceinline__ void mbarrier_init(uint64_t* bar, uint32_t count) {
#if SM90A_ENABLED
    uint32_t addr = smem_addr(bar);
    asm volatile("mbarrier.init.shared.b64 [%0], %1;" : : "r"(addr), "r"(count));
#else
    (void)bar;
    (void)count;
#endif
}

__device__ __forceinline__ void mbarrier_expect_tx(uint64_t* bar, uint32_t bytes) {
#if SM90A_ENABLED
    uint32_t addr = smem_addr(bar);
    asm volatile("mbarrier.expect_tx.shared.b64 [%0], %1;" : : "r"(addr), "r"(bytes));
#else
    (void)bar;
    (void)bytes;
#endif
}

__device__ __forceinline__ uint64_t mbarrier_arrive(uint64_t* bar) {
#if SM90A_ENABLED
    uint32_t addr = smem_addr(bar);
    uint64_t state = 0;
    asm volatile("mbarrier.arrive.shared.b64 %0, [%1];" : "=l"(state) : "r"(addr));
    asm volatile("" : : "l"(state));
    return state;
#else
    (void)bar;
    return 0;
#endif
}

__device__ __forceinline__ void mbarrier_wait(uint64_t* bar, uint32_t phase) {
#if SM90A_ENABLED
    uint32_t addr = smem_addr(bar);
    uint64_t dummy = 0;
    asm volatile("mbarrier.wait.shared.b64 %0, [%1], %2;"
                 : "=l"(dummy)
                 : "r"(addr), "r"(phase));
    (void)dummy;
#else
    (void)bar;
    (void)phase;
#endif
}

__device__ __forceinline__ void fence_proxy_async() {
#if SM90A_ENABLED
    asm volatile("fence.proxy.async.shared::cluster;");
#endif
}

__device__ __forceinline__ void wgmma_fence() {
#if SM90A_ENABLED
    asm volatile("wgmma.fence.sync.aligned;");
#endif
}

__device__ __forceinline__ void wgmma_wait_group_0() {
#if SM90A_ENABLED
    asm volatile("wgmma.wait_group.sync.aligned 0;");
#endif
}

__device__ __forceinline__ void tma_load_2d(const CUtensorMap* desc,
                                            void* smem_ptr,
                                            uint32_t coord0,
                                            uint32_t coord1,
                                            uint64_t* bar) {
#if SM90A_ENABLED
    uint32_t smem = smem_addr(smem_ptr);
    uint32_t bar_addr = smem_addr(bar);
    unsigned long long desc_ptr = reinterpret_cast<unsigned long long>(desc);
    asm volatile(
        "cp.async.bulk.tensor.2d.shared::cluster.global.mbarrier::complete_tx::bytes "
        "[%0], [%1, {%2, %3}], [%4];"
        :
        : "r"(smem), "l"(desc_ptr), "r"(coord0), "r"(coord1), "r"(bar_addr)
        : "memory");
#else
    (void)desc;
    (void)smem_ptr;
    (void)coord0;
    (void)coord1;
    (void)bar;
#endif
}

struct WgmmaFrag {
    float reg[64];
};

__device__ __forceinline__ void store_registers_to_smem(float* smem_out,
                                                        const WgmmaFrag& acc,
                                                        int thread_in_group) {
#if SM90A_ENABLED
    // Architectural Note:
    // WGMMA accumulators are "fragmented" across the 128-thread warp-group.
    // Each thread owns 64 FP32 registers that are *not* laid out linearly in
    // logical matrix order. The bitwise mapping below reassembles each thread's
    // fragment into the correct (row, col) position within the logical 64x128 tile.
    // This is the critical bridge from the WGMMA register file layout to a
    // canonical shared-memory matrix tile.
    int t0 = thread_in_group & 3;
    int t1 = (thread_in_group >> 2) & 7;
    int t2 = (thread_in_group >> 5) & 3;

    // PTX WGMMA accumulator layout (CLayout_64x64) extended to N=128 via an extra value bit.
    #pragma unroll
    for (int r = 0; r < 64; ++r) {
        int v0 = r & 1;
        int v1 = (r >> 1) & 1;
        int v2 = (r >> 2) & 7;
        int v3 = (r >> 5) & 1;

        int linear = t0 * 128 + t1 * 1 + t2 * 16 + v0 * 64 + v1 * 8 + v2 * 512 + v3 * 4096;
        int row = linear & 63;
        int col = linear >> 6;
        smem_out[row * kTileN + col] = acc.reg[r];
    }
#else
    (void)smem_out;
    (void)acc;
    (void)thread_in_group;
#endif
}

__device__ __forceinline__ void wgmma_m64n128k8_f32(WgmmaFrag& acc,
                                                    unsigned long long descA,
                                                    unsigned long long descB) {
#if SM90A_ENABLED
    asm volatile(
        "wgmma.mma_async.m64n128k8.f32.f32.f32 "
        "{%0, %1, %2, %3, %4, %5, %6, %7, "
        " %8, %9, %10, %11, %12, %13, %14, %15, "
        " %16, %17, %18, %19, %20, %21, %22, %23, "
        " %24, %25, %26, %27, %28, %29, %30, %31, "
        " %32, %33, %34, %35, %36, %37, %38, %39, "
        " %40, %41, %42, %43, %44, %45, %46, %47, "
        " %48, %49, %50, %51, %52, %53, %54, %55, "
        " %56, %57, %58, %59, %60, %61, %62, %63}, "
        "%64, %65, 1, 1;"
        : "+f"(acc.reg[0]), "+f"(acc.reg[1]), "+f"(acc.reg[2]), "+f"(acc.reg[3]),
          "+f"(acc.reg[4]), "+f"(acc.reg[5]), "+f"(acc.reg[6]), "+f"(acc.reg[7]),
          "+f"(acc.reg[8]), "+f"(acc.reg[9]), "+f"(acc.reg[10]), "+f"(acc.reg[11]),
          "+f"(acc.reg[12]), "+f"(acc.reg[13]), "+f"(acc.reg[14]), "+f"(acc.reg[15]),
          "+f"(acc.reg[16]), "+f"(acc.reg[17]), "+f"(acc.reg[18]), "+f"(acc.reg[19]),
          "+f"(acc.reg[20]), "+f"(acc.reg[21]), "+f"(acc.reg[22]), "+f"(acc.reg[23]),
          "+f"(acc.reg[24]), "+f"(acc.reg[25]), "+f"(acc.reg[26]), "+f"(acc.reg[27]),
          "+f"(acc.reg[28]), "+f"(acc.reg[29]), "+f"(acc.reg[30]), "+f"(acc.reg[31]),
          "+f"(acc.reg[32]), "+f"(acc.reg[33]), "+f"(acc.reg[34]), "+f"(acc.reg[35]),
          "+f"(acc.reg[36]), "+f"(acc.reg[37]), "+f"(acc.reg[38]), "+f"(acc.reg[39]),
          "+f"(acc.reg[40]), "+f"(acc.reg[41]), "+f"(acc.reg[42]), "+f"(acc.reg[43]),
          "+f"(acc.reg[44]), "+f"(acc.reg[45]), "+f"(acc.reg[46]), "+f"(acc.reg[47]),
          "+f"(acc.reg[48]), "+f"(acc.reg[49]), "+f"(acc.reg[50]), "+f"(acc.reg[51]),
          "+f"(acc.reg[52]), "+f"(acc.reg[53]), "+f"(acc.reg[54]), "+f"(acc.reg[55]),
          "+f"(acc.reg[56]), "+f"(acc.reg[57]), "+f"(acc.reg[58]), "+f"(acc.reg[59]),
          "+f"(acc.reg[60]), "+f"(acc.reg[61]), "+f"(acc.reg[62]), "+f"(acc.reg[63])
        : "l"(descA), "l"(descB));
#else
    (void)acc;
    (void)descA;
    (void)descB;
#endif
}

__device__ __forceinline__ void swizzle_block_idx(int grid_n, int& tile_m, int& tile_n) {
    constexpr int kRaster = 4;
    int raw_m = blockIdx.y;
    int raw_n = blockIdx.x;
    int group = raw_n / kRaster;
    int offset = raw_n % kRaster;
    if (raw_m & 1) {
        offset = kRaster - 1 - offset;
    }
    tile_m = raw_m;
    tile_n = group * kRaster + offset;
    if (tile_n >= grid_n) {
        tile_n = raw_n;
    }
}

__device__ void gemm_generic(const float* A, const float* B, float* C, int M, int N, int K) {
    int row = blockIdx.y * blockDim.y + threadIdx.y;
    int col = blockIdx.x * blockDim.x + threadIdx.x;
    if (row >= M || col >= N) {
        return;
    }
    float sum = 0.0f;
    int a_base = row * K;
    for (int k = 0; k < K; ++k) {
        sum += A[a_base + k] * B[k * N + col];
    }
    C[row * N + col] = sum;
}

__device__ void gemm_optimized_sm90(const float* A, const float* B, float* C, int M, int N, int K) {
#if SM90A_ENABLED
    /*
     * Architectural Notes — Warp Specialization (WS) on SM90A:
     * - Warp 0 is the Producer. It is dedicated to issuing TMA (Tensor Memory Access)
     *   operations that move tiles of A/B from Global Memory to Shared Memory.
     * - Warps 1–4 form a Consumer Warp-group (128 threads). They act as a single
     *   cooperative unit to issue WGMMA (warp-group MMA) instructions on the
     *   shared-memory tiles produced by Warp 0.
     *
     * Rationale:
     * - TMA is a small number of control operations best handled by one warp
     *   (specifically lane 0 as a proxy) to avoid redundant TMA commands.
     * - WGMMA is a warp-group operation; the hardware expects a 128-thread group
     *   to participate for correct scheduling and register fragment distribution.
     */
    extern __shared__ uint8_t smem[];
    uint64_t* barriers_ready = reinterpret_cast<uint64_t*>(smem);
    uint64_t* barriers_done = barriers_ready + kStages;
    uint8_t* smem_tiles = smem + smem_barrier_bytes();
    float* smem_out = reinterpret_cast<float*>(smem_tiles + smem_stage_bytes() * kStages);

    if (threadIdx.x == 0) {
        // Dual-Barrier Pipeline:
        // - barriers_ready: signals a stage has fresh data produced by TMA.
        // - barriers_done : signals consumers finished using a stage (back-pressure).
        // This prevents the producer from overwriting tiles still in use.
        for (int i = 0; i < kStages; ++i) {
            mbarrier_init(&barriers_ready[i], 1);
            mbarrier_init(&barriers_done[i], 1);
            uint64_t state = mbarrier_arrive(&barriers_done[i]);
            if (state == 0) {
                // Prevent "set but unused" warnings: the empty asm with an input operand
                // makes the compiler treat `state` as used without changing codegen.
                asm volatile("" : : "l"(state));
            }
        }
    }
    __syncthreads();

    int grid_n = (N + kTileN - 1) / kTileN;
    int tile_m = 0;
    int tile_n = 0;
    swizzle_block_idx(grid_n, tile_m, tile_n);

    // Warp role assignment for WS.
    int warp = threadIdx.x >> 5;
    int lane = threadIdx.x & 31;
    bool is_producer = (warp == 0);
    bool is_consumer = (warp >= 1 && warp <= 4);
    bool is_consumer_leader = is_consumer && (warp == 1) && (lane == 0);

    const uint32_t bytes_per_stage =
        static_cast<uint32_t>(kTileM * kTileK * sizeof(float) + kTileK * kTileN * sizeof(float));

    if (is_producer && lane == 0) {
        // Producer Proxy (Lane 0):
        // Only lane 0 issues TMA commands. This avoids redundant TMA instructions
        // and provides a single "proxy" control flow for the warp.
        for (int s = 0; s < kStages; ++s) {
            int k0 = s * kTileK;
            if (k0 >= K) {
                break;
            }
            // Back-pressure: wait until consumers mark this stage "done".
            uint32_t phase = 0;
            mbarrier_wait(&barriers_done[s], phase);
            uint8_t* stage_ptr = smem_tiles + s * smem_stage_bytes();
            float* smemA = reinterpret_cast<float*>(stage_ptr);
            float* smemB = reinterpret_cast<float*>(stage_ptr + kTileM * kTileK * sizeof(float));
            mbarrier_expect_tx(&barriers_ready[s], bytes_per_stage);
            // TMA descriptors map Global -> Shared tiles; coordinates are in elements.
            tma_load_2d(&g_tmaA, smemA, k0, tile_m * kTileM, &barriers_ready[s]);
            tma_load_2d(&g_tmaB, smemB, tile_n * kTileN, k0, &barriers_ready[s]);
            uint64_t state = mbarrier_arrive(&barriers_ready[s]);
            if (state == 0) {
                asm volatile("" : : "l"(state));
            }
        }
    }

    // WGMMA accumulator initialization (per thread in the warp-group).
    // WgmmaFrag holds the 64 FP32 accumulator registers per thread that WGMMA writes.
    // Only consumer warp-group threads actually use these registers; the producer
    // still allocates the object because all threads execute this code path.
    WgmmaFrag wgmma_acc;
    for (int i = 0; i < 64; ++i) {
        wgmma_acc.reg[i] = 0.0f;
    }
    if (is_consumer) {
        // fence.proxy.async ensures TMA writes are visible before WGMMA reads.
        wgmma_fence();
    }

    int row_base = 0;
    int col_base = 0;
    int thread_in_group = -1;
    if (is_consumer) {
        thread_in_group = threadIdx.x - 32;
        int block_m = thread_in_group & 7;
        int block_n = thread_in_group >> 3;
        row_base = block_m * 8;
        col_base = block_n * 8;
    }

    for (int k0 = 0; k0 < K; k0 += kTileK) {
        int stage = (k0 / kTileK) % kStages;
        if (is_consumer) {
            int iter = k0 / kTileK;
            // Phase parity flips every time a stage is reused.
            // With kStages=3, (iter/kStages)%2 toggles per full pipeline rotation.
            uint32_t phase = (iter / kStages) % 2;
            mbarrier_wait(&barriers_ready[stage], phase);

            // Memory-Ordering:
            // fence.proxy.async makes proxy TMA writes visible to the warp-group.
            fence_proxy_async();

            uint8_t* stage_ptr = smem_tiles + stage * smem_stage_bytes();
            float* smemA = reinterpret_cast<float*>(stage_ptr);
            float* smemB = reinterpret_cast<float*>(stage_ptr + kTileM * kTileK * sizeof(float));

            // Consumer Warp-group (128 threads) issues WGMMA on the ready tiles.
            // Swizzled shared-memory layout reduces bank conflicts for WGMMA loads.
            for (int kk = 0; kk < kTileK; kk += 8) {
                unsigned long long descA =
                    make_wgmma_desc(smemA + kk, kTileK * sizeof(float), kSwizzle128B);
                unsigned long long descB =
                    make_wgmma_desc(smemB + kk * kTileN, kTileN * sizeof(float), kSwizzle128B);
                wgmma_m64n128k8_f32(wgmma_acc, descA, descB);
            }
            // Ensure all WGMMA ops in the group are complete before releasing the stage.
            wgmma_wait_group_0();

            if (is_consumer_leader) {
                // Release stage for producer (back-pressure mechanism).
                uint64_t state = mbarrier_arrive(&barriers_done[stage]);
                if (state == 0) {
                    asm volatile("" : : "l"(state));
                }
            }
        }

        if (is_producer && lane == 0) {
            int next_k = k0 + kStages * kTileK;
            if (next_k < K) {
                int next_iter = next_k / kTileK;
                // Producer waits for the consumer to finish before overwriting.
                uint32_t phase = (next_iter / kStages) % 2;
                mbarrier_wait(&barriers_done[stage], phase);
                uint8_t* next_ptr = smem_tiles + stage * smem_stage_bytes();
                float* nextA = reinterpret_cast<float*>(next_ptr);
                float* nextB = reinterpret_cast<float*>(next_ptr + kTileM * kTileK * sizeof(float));
                mbarrier_expect_tx(&barriers_ready[stage], bytes_per_stage);
                tma_load_2d(&g_tmaA, nextA, next_k, tile_m * kTileM, &barriers_ready[stage]);
                tma_load_2d(&g_tmaB, nextB, tile_n * kTileN, next_k, &barriers_ready[stage]);
                uint64_t state = mbarrier_arrive(&barriers_ready[stage]);
                if (state == 0) {
                    asm volatile("" : : "l"(state));
                }
            }
        }
    }

    if (is_consumer) {
        // Epilogue:
        // wgmma_wait_group ensures all accumulator fragments are finalized
        // before we remap registers into a canonical shared-memory tile.
        wgmma_wait_group_0();
        store_registers_to_smem(smem_out, wgmma_acc, thread_in_group);
    }

    __syncthreads();

    if (is_consumer) {
        // Final writeback: Shared -> Global.
        int global_row = tile_m * kTileM + row_base;
        int global_col = tile_n * kTileN + col_base;
        for (int i = 0; i < 8; ++i) {
            int row = global_row + i;
            if (row >= M) {
                continue;
            }
            int smem_offset = (row_base + i) * kTileN + col_base;
            for (int j = 0; j < 8; ++j) {
                int col = global_col + j;
                if (col < N) {
                    C[row * N + col] = smem_out[smem_offset + j];
                }
            }
        }
    }
#else
    gemm_generic(A, B, C, M, N, K);
#endif
}

__global__ void matrix_multiplication_kernel(const float* A, const float* B, float* C, int M, int N, int K) {
    if (M == kPerfM && N == kPerfN && K == kPerfK) {
        gemm_optimized_sm90(A, B, C, M, N, K);
    } else {
        gemm_generic(A, B, C, M, N, K);
    }
}

static void init_tma_descriptors(const float* A, const float* B, int M, int N, int K) {
#if defined(CU_TENSOR_MAP_SWIZZLE_128B)
    CUtensorMap tmaA;
    CUtensorMap tmaB;
    const cuuint64_t gdimA[2] = {static_cast<cuuint64_t>(K), static_cast<cuuint64_t>(M)};
    const cuuint64_t gdimB[2] = {static_cast<cuuint64_t>(N), static_cast<cuuint64_t>(K)};
    const cuuint64_t gstrideA[2] = {static_cast<cuuint64_t>(sizeof(float)),
                                    static_cast<cuuint64_t>(K * sizeof(float))};
    const cuuint64_t gstrideB[2] = {static_cast<cuuint64_t>(sizeof(float)),
                                    static_cast<cuuint64_t>(N * sizeof(float))};
    const cuuint32_t boxA[2] = {static_cast<cuuint32_t>(kTileK), static_cast<cuuint32_t>(kTileM)};
    const cuuint32_t boxB[2] = {static_cast<cuuint32_t>(kTileN), static_cast<cuuint32_t>(kTileK)};
    const cuuint32_t elemStride[2] = {1, 1};

    // TMA descriptor encoding (cuTensorMapEncode):
    //  - &tmaA / &tmaB: output descriptor storage (CUtensorMap).
    //  - CU_TENSOR_MAP_DATA_TYPE_FLOAT32: element type in global memory.
    //  - 2: tensor rank (2D).
    //  - A / B: base pointer in global memory.
    //  - gdim*: global dimensions in element units (inner, outer for row-major).
    //  - gstride*: global strides in bytes for each dimension.
    //  - box*: tile (box) size in elements for each dimension (KxM or NxK).
    //  - elemStride: per-dimension element stride (usually {1,1} for contiguous).
    //  - CU_TENSOR_MAP_INTERLEAVE_NONE: no interleaving.
    //  - CU_TENSOR_MAP_SWIZZLE_128B: 128B swizzle to reduce SMEM bank conflicts.
    //  - CU_TENSOR_MAP_L2_PROMOTION_NONE: no special L2 promotion.
    //  - CU_TENSOR_MAP_OOB_FILL_NONE: no out-of-bounds fill policy.
    (void)cuTensorMapEncode(&tmaA,
                            CU_TENSOR_MAP_DATA_TYPE_FLOAT32,
                            2,
                            A,
                            gdimA,
                            gstrideA,
                            boxA,
                            elemStride,
                            CU_TENSOR_MAP_INTERLEAVE_NONE,
                            CU_TENSOR_MAP_SWIZZLE_128B,
                            CU_TENSOR_MAP_L2_PROMOTION_NONE,
                            CU_TENSOR_MAP_OOB_FILL_NONE);
    (void)cuTensorMapEncode(&tmaB,
                            CU_TENSOR_MAP_DATA_TYPE_FLOAT32,
                            2,
                            B,
                            gdimB,
                            gstrideB,
                            boxB,
                            elemStride,
                            CU_TENSOR_MAP_INTERLEAVE_NONE,
                            CU_TENSOR_MAP_SWIZZLE_128B,
                            CU_TENSOR_MAP_L2_PROMOTION_NONE,
                            CU_TENSOR_MAP_OOB_FILL_NONE);

    cudaMemcpyToSymbol(g_tmaA, &tmaA, sizeof(CUtensorMap));
    cudaMemcpyToSymbol(g_tmaB, &tmaB, sizeof(CUtensorMap));
#else
    (void)A;
    (void)B;
    (void)M;
    (void)N;
    (void)K;
#endif
}

// A, B, C are device pointers (i.e. pointers to memory on the GPU)
extern "C" void solve(const float* A, const float* B, float* C, int M, int N, int K) {
    cudaDeviceProp prop{};
    cudaGetDeviceProperties(&prop, 0);
    bool sm90 = (prop.major == 9 && prop.minor == 0);

    if (M == kPerfM && N == kPerfN && K == kPerfK && sm90) {
        init_tma_descriptors(A, B, M, N, K);
        dim3 threadsPerBlock(160, 1, 1);
        dim3 blocksPerGrid((N + kTileN - 1) / kTileN, (M + kTileM - 1) / kTileM, 1);
        size_t smem = smem_bytes_total();
        cudaFuncSetAttribute(matrix_multiplication_kernel,
                             cudaFuncAttributeMaxDynamicSharedMemorySize,
                             static_cast<int>(smem));
        matrix_multiplication_kernel<<<blocksPerGrid, threadsPerBlock, smem>>>(A, B, C, M, N, K);
    } else {
        dim3 threadsPerBlock(16, 16);
        dim3 blocksPerGrid((N + threadsPerBlock.x - 1) / threadsPerBlock.x,
                           (M + threadsPerBlock.y - 1) / threadsPerBlock.y);
        matrix_multiplication_kernel<<<blocksPerGrid, threadsPerBlock>>>(A, B, C, M, N, K);
    }
    cudaDeviceSynchronize();
}

```

一个编译不过的 fp32 gemm，大概看看 warp spec 的写法。

## TMA 和 WGMMA

TMA 专用的异步访问硬件，主要是开始的时候需要传描述符，同时 load 到 shared mem 上时要开出 barrier 的描述位，
因为目的地址就是 shared mem。store 回 gmem 的时候有不同的 api。同时一维和二维api好像也不太一样。

WGMMA 异步调用 tensorcore，一样的也要 mark 标记的。WGMMA 也要传描述符的，不过好像是在 device 端。
WGMMA 是把 4 个 warp，128 个线程打成一组来做 MMA，这样更像 SM 中的 4 个 subcore 被视为一个 core 了。
具体的尺寸指定要看 ptx 中的文档怎么写。

这些功能都要通过内连汇编作调用，貌似没有现成的 cuda api。

## GEMM

反正对三个维度尺寸都大的写法和之前 a100 上的写法没什么区别，只不过不同 `cp.async`、`ldmatrix` 等了，
现在直接走 TMA。整体来说还是总体先对 M N 维度进行分块，单个 block 处理由 M N 分过的块，处理的时候
要注意 L2 级别的亲和性，总体来说就是对结果矩阵上适合 L2 大小的抽出来先处理。

在 block 内部，继续对 M N 分块，然后把拿到的小块打到 tensorcore 上算，然后按着 k 的维度迭代把
整个算完的。实际上内部还是分多 buffer 的，就跟之前的写法一样，分多个 buffer 实际上每次的计算都是
对单个 buffer 进行。在一开始的时候，TMA 首先要把所有 buffer 打满做准备。然后就是一个 buffer 算完了，
计算移到下一个阶段，然后 TMA 移到当前阶段，把数据补上去。

buffer 的划分是个问题，到底是双 buffer、三 buffer、还是更多的 buffer。在多个 buffer 的情况下，计算只针对
单个 buffer 进行，时间开销是单 buffer 的计算时间，TMA 虽然也是针对单个 buffer，但是由于多个buffer设计，
前面还有好几个 buffer 用于容忍存储的延时，相当于至多有 $T_{comp} \times (Num_{buffer} - 1)$ 的延时可以容忍。
buffer 分的越多，由于 shared mem 容量是固定的，开出来的 buffer 多，单个 buffer 内的计算量就少，活跃的 Warp 打不上去，算力用不满。所以可能 2 或者 3 buffer 就比较合适了，具体结合着算一下。

nvidia 最新的 cluster 分组和多播可能会把 GEMM 的编写变得更复杂，弄不懂了，以后在学。
