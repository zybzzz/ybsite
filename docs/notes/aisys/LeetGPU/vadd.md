# vector add

向量加法，跑在 h100 上。

```cpp
#include <cuda_runtime.h>

__global__ void vector_add(const float* __restrict__ A,
                           const float* __restrict__ B,
                           float* __restrict__ C,
                           int N) {
    int idx = blockIdx.x * blockDim.x + threadIdx.x;
    int stride = blockDim.x * gridDim.x;

    int n4 = N / 4;
    const float4* A4 = reinterpret_cast<const float4*>(A);
    const float4* B4 = reinterpret_cast<const float4*>(B);
    float4* C4 = reinterpret_cast<float4*>(C);

    // Single float4 per iteration; use read-only cache for loads.
    for (int i = idx; i < n4; i += stride) {
        float4 a0 = __ldg(A4 + i);
        float4 b0 = __ldg(B4 + i);
        float4 c0 = {a0.x + b0.x, a0.y + b0.y, a0.z + b0.z, a0.w + b0.w};
        C4[i] = c0;
    }

    // Tail handling for elements not divisible by 4.
    int tail_start = n4 * 4;
    for (int i = tail_start + idx; i < N; i += stride) {
        C[i] = __ldg(A + i) + __ldg(B + i);
    }
}

// A, B, C are device pointers (i.e. pointers to memory on the GPU)
extern "C" void solve(const float* A, const float* B, float* C, int N) {
    int threadsPerBlock = 256;
    int blocksPerGrid = max(1, (N / 4 + threadsPerBlock - 1) / threadsPerBlock);

    vector_add<<<blocksPerGrid, threadsPerBlock>>>(A, B, C, N);
    cudaDeviceSynchronize();
}
```

1. 使用 ldg，在 read only 的这种流式读的情况下它可能比普通情况更好。
2. 每个线程有序的去拿自己的就行了，需要考虑到外面 block 数可能过多或者过少的情况。
3. 直接内存带宽打满就行了。
