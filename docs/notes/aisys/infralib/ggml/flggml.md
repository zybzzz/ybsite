# 初探 ggml

ggml 是 llama.cpp 会调用的一个底层库，主要封装了一些低层次的操作，包括基本的算子和量化支持等等。支持多个后端 cpu gpu 等等都支持。ggml 代码写的非常好，很清晰，可读性强。

## 简单部署流程

1. 定义 context，context 全局存在，里面包含很多上下文信息，同时内存管理也是在 context 中管理的。ggml 内部有他自己的内存分配实现，通过 backend buffer 的类型来分配类型。
2. 定义张量，把要计算的东西定义掉。
3. 定义计算，构建计算图，计算图表示要计算的东西。
4. 计算，交到指定的后端进行计算，分析结果。

## 关键数据结构

### tensor

```cpp
// n-dimensional tensor
struct ggml_tensor {
    enum ggml_type type;    // 数据类型

    // 指向后端管理整个过程中内存的数据结构
    // no_alloc = false 的情况下为 空
    // no_alloc = true 在分配内存的时候会创建
    struct ggml_backend_buffer * buffer;    

    // 每一维度几个元素
    // 维度从小到大排列，比如<3, 4>的矩阵这里表示为 [4,3]
    int64_t ne[GGML_MAX_DIMS]; // number of elements
    // 每个维度的访问跨距，支持分块
    // nb[0] 单个元素
    // nb[1] 理论上是一行，但是可能分块，具体看分块怎么算
    size_t  nb[GGML_MAX_DIMS]; // stride in bytes:
                                // nb[0] = ggml_type_size(type)
                                // nb[1] = nb[0]   * (ne[0] / ggml_blck_size(type)) + padding
                                // nb[i] = nb[i-1] * ne[i-1]

    // compute data
    // 计算的相关操作
    enum ggml_op op;

    // op params - allocated as int32_t for alignment
    int32_t op_params[GGML_MAX_OP_PARAMS / sizeof(int32_t)];

    int32_t flags;

    struct ggml_tensor * src[GGML_MAX_SRC];

    // source tensor and offset for views
    // 这个操作是在节省内存，很多时候向量做一下 reshape 的操作
    // 就不用重新分配内存，搞个 tensor 指针指向原来那个，然后改变访问方式就行了
    // 表示这是一个视图，也就是指向别的张量的指针
    struct ggml_tensor * view_src;
    // 视图距离开始的 offset
    size_t               view_offs;

    // view: 指向现成的
    // no view && no_alloc: 空，等 backend 分配
    // no view && !no_alloc: 立即分配，分配出的内存在 context 管理
    // 内存的管理方式有点像 [sizeof(tensor) + data] 这样的组织
    void * data;

    char name[GGML_MAX_NAME];

    void * extra; // extra things e.g. for ggml-cuda.cu

    char padding[8];
};

```

### backend buffer

```cpp
//
// Backend buffer type
//

// 提供后端类型等等的相关操作
struct ggml_backend_buffer_type_i {
    const char *          (*get_name)      (ggml_backend_buffer_type_t buft);
    // allocate a buffer of this type
    ggml_backend_buffer_t (*alloc_buffer)  (ggml_backend_buffer_type_t buft, size_t size);
    // tensor alignment
    size_t                (*get_alignment) (ggml_backend_buffer_type_t buft);
    // (optional) max buffer size that can be allocated (defaults to SIZE_MAX)
    size_t                (*get_max_size)  (ggml_backend_buffer_type_t buft);
    // (optional) data size needed to allocate the tensor, including padding (defaults to ggml_nbytes)
    size_t                (*get_alloc_size)(ggml_backend_buffer_type_t buft, const struct ggml_tensor * tensor);
    // (optional) check if tensor data is in host memory and uses standard ggml tensor layout (defaults to false)
    bool                  (*is_host)       (ggml_backend_buffer_type_t buft);
};

// 指定到底属于哪种类型的后端
struct ggml_backend_buffer_type {
    struct ggml_backend_buffer_type_i  iface;
    ggml_backend_dev_t device;
    void * context;
};

//
// Backend buffer
//

// 访问 tensor 的方式
struct ggml_backend_buffer_i {
    // (optional) free the buffer
    void         (*free_buffer)  (ggml_backend_buffer_t buffer);
    // base address of the buffer
    void *       (*get_base)     (ggml_backend_buffer_t buffer);
    // (optional) initialize a tensor in the buffer (eg. add tensor extras)
    enum ggml_status (*init_tensor)(ggml_backend_buffer_t buffer, struct ggml_tensor * tensor);
    // tensor data access
    void         (*memset_tensor)(ggml_backend_buffer_t buffer,       struct ggml_tensor * tensor,     uint8_t value, size_t offset, size_t size);
    void         (*set_tensor)   (ggml_backend_buffer_t buffer,       struct ggml_tensor * tensor, const void * data, size_t offset, size_t size);
    void         (*get_tensor)   (ggml_backend_buffer_t buffer, const struct ggml_tensor * tensor,       void * data, size_t offset, size_t size);
    // (optional) tensor copy: dst is in the buffer, src may be in any buffer, including buffers from a different backend (return false if not supported)
    bool         (*cpy_tensor)   (ggml_backend_buffer_t buffer, const struct ggml_tensor * src, struct ggml_tensor * dst);
    // clear the entire buffer
    void         (*clear)        (ggml_backend_buffer_t buffer, uint8_t value);
    // (optional) reset any internal state due to tensor initialization, such as tensor extras
    void         (*reset)        (ggml_backend_buffer_t buffer);
};

// 提供了信息以及访问 tensor 内存的方式
struct ggml_backend_buffer {
    struct ggml_backend_buffer_i  iface;
    ggml_backend_buffer_type_t    buft;
    void * context;
    size_t size;
    enum ggml_backend_buffer_usage usage;
};

```


### ggml_object

```cpp
struct ggml_object {
    size_t offs;
    size_t size;

    struct ggml_object * next;

    enum ggml_object_type type;

    char padding[4];
};
```

就是用 offset 指示分配出来的裸内存从哪里分配出来， size 指示分配出来的内存大小。

### 枚举

枚举了 ggml_type 表示数据类型，数据类型具体定义可以看[llama.cpp wiki](https://github.com/ggml-org/llama.cpp/wiki/Tensor-Encoding-Schemes)。同时也枚举了计算类型，很多都在 `ggml.h` 中。

### ggml_type_traits 

定义了数据类型相关的特征和操作。

```cpp
typedef void (*ggml_to_float_t)  (const void  * GGML_RESTRICT x, float * GGML_RESTRICT y, int64_t k);
typedef void (*ggml_from_float_t)(const float * GGML_RESTRICT x, void  * GGML_RESTRICT y, int64_t k);

struct ggml_type_traits {
    const char             * type_name;  //名称
    int64_t                  blck_size;  // block 相关的
    int64_t                  blck_size_interleave; // interleave elements in blocks
    size_t                   type_size;
    bool                     is_quantized; // 是不是不用量化的类型
    ggml_to_float_t          to_float;      // 怎么从这个类型反量化回 fp32
    ggml_from_float_t        from_float_ref;    // 怎么从 fp32 量化成这个类型
};
```

还会有个 `ggml_type_cpu_traits` 是用在 cpu 简单 test 的时候的特供版本，在库里我没看到有使用。

## 文件组织

1. `ggml.c`：封装大多数的定义。
2. `ggml.c`： 实现。
3. `ggml_backend_impl.h`：封装后端需要实现的接口和类型等等。

src 下文件有点复杂，cpu 后端的有一部分实现也实现在了这里的 `.c`文件中，应该把 x86 的后端当成了一种默认实现。对于计算操作的实现，ggml 对每种类型都提供了 cpu 上的默认实现，称为 ref，在后端还会有专门的实现。

## 几个函数

### tensor init

```cpp
static struct ggml_tensor * ggml_new_tensor_impl(
        struct ggml_context * ctx,
        enum   ggml_type      type,
        int                   n_dims,
        const int64_t       * ne,
        struct ggml_tensor  * view_src,
        size_t                view_offs) {

    GGML_ASSERT(type >= 0 && type < GGML_TYPE_COUNT);
    GGML_ASSERT(n_dims >= 1 && n_dims <= GGML_MAX_DIMS);

    // find the base tensor and absolute offset
    // 有 view 设置 view
    if (view_src != NULL && view_src->view_src != NULL) {
        view_offs += view_src->view_offs;
        view_src   = view_src->view_src;
    }

    // data size count how many block
    // left to right, lower to high
    // 算这个 tensor 总共的 datasize 有多大
    size_t data_size = ggml_row_size(type, ne[0]);
    for (int i = 1; i < n_dims; i++) {
        data_size *= ne[i];
    }

    GGML_ASSERT(view_src == NULL || data_size == 0 || data_size + view_offs <= ggml_nbytes(view_src));

    void * data = view_src != NULL ? view_src->data : NULL;
    // 如果有 view， 把 data 指向 view
    if (data != NULL) {
        data = (char *) data + view_offs;
    }

    size_t obj_alloc_size = 0;

    if (view_src == NULL && !ctx->no_alloc) {
        // allocate tensor data in the context's memory pool
        // no_alloc = false，立即由 ctx 分配
        obj_alloc_size = data_size;
    }

    // all the memory may malloc in ctx buffer
    // so use offset + buffer to access obj
    // ctx 分配出内存
    struct ggml_object * const obj_new = ggml_new_object(ctx, GGML_OBJECT_TYPE_TENSOR, GGML_TENSOR_SIZE + obj_alloc_size);
    GGML_ASSERT(obj_new);

    // 设置 Result 指向 ctx 分配出的内存
    struct ggml_tensor * const result = (struct ggml_tensor *)((char *)ctx->mem_buffer + obj_new->offs);

    // if real alloc data, data store in tensor.buffer
    // maybe lazy alloc
    // buffer struct wait to be allocate
    // 各种初始化
    *result = (struct ggml_tensor) {
        /*.type         =*/ type,
        /*.buffer       =*/ NULL,
        /*.ne           =*/ { 1, 1, 1, 1 },
        /*.nb           =*/ { 0, 0, 0, 0 },
        /*.op           =*/ GGML_OP_NONE,
        /*.op_params    =*/ { 0 },
        /*.flags        =*/ 0,
        /*.src          =*/ { NULL },
        /*.view_src     =*/ view_src,
        /*.view_offs    =*/ view_offs,
        // 这里如果直接分配了就指向
        // 没有直接分配等后端的 buffer 分配
        /*.data         =*/ obj_alloc_size > 0 ? (void *)(result + 1) : data,
        /*.name         =*/ { 0 },
        /*.extra        =*/ NULL,
        /*.padding      =*/ { 0 },
    };

    // TODO: this should not be needed as long as we don't rely on aligned SIMD loads
    //GGML_ASSERT_ALIGNED(result->data);

    // 算 NE 和 NB
    for (int i = 0; i < n_dims; i++) {
        result->ne[i] = ne[i];
    }

    // offset be small but iter will be more
    result->nb[0] = ggml_type_size(type);
    result->nb[1] = result->nb[0]*(result->ne[0]/ggml_blck_size(type));
    for (int i = 2; i < GGML_MAX_DIMS; i++) {
        result->nb[i] = result->nb[i - 1]*result->ne[i - 1];
    }

    ctx->n_objects++;

    return result;
}

```

### quantize

```cpp
size_t ggml_quantize_chunk(
        enum ggml_type   type,
           const float * src,
                  void * dst,
               int64_t   start,
               int64_t   nrows,
               int64_t   n_per_row,
           const float * imatrix) {
    const int64_t n = (int64_t) nrows * n_per_row;

    // 将 FP32 量化到各种数据类型

    // 检测量化过程是不是需要辅助的矩阵
    if (ggml_quantize_requires_imatrix(type)) {
        GGML_ASSERT(imatrix != NULL);
    }

    // 检查内存对齐
    GGML_ASSERT(start % type_traits[type].blck_size == 0);
    GGML_ASSERT(start % n_per_row == 0);

    ggml_quantize_init(type); // this is noop if already initialized

    // 从第几行开始
    const size_t start_row = start / n_per_row;
    // 一行有几个
    const size_t row_size  = ggml_row_size(type, n_per_row);

    size_t result = 0;

    // per row quant
    switch (type) {
        // 从 src + start 开始，到 (char *) dst + start_row * row_size， 总共量化 nrows
        case GGML_TYPE_Q4_0:    result = quantize_q4_0(src + start, (char *) dst + start_row * row_size, nrows, n_per_row, imatrix); break;
        case GGML_TYPE_Q4_1:    result = quantize_q4_1(src + start, (char *) dst + start_row * row_size, nrows, n_per_row, imatrix); break;
        case GGML_TYPE_Q5_0:    result = quantize_q5_0(src + start, (char *) dst + start_row * row_size, nrows, n_per_row, imatrix); break;
        case GGML_TYPE_Q5_1:    result = quantize_q5_1(src + start, (char *) dst + start_row * row_size, nrows, n_per_row, imatrix); break;
        case GGML_TYPE_Q8_0:    result = quantize_q8_0(src + start, (char *) dst + start_row * row_size, nrows, n_per_row, imatrix); break;
        case GGML_TYPE_Q2_K:    result = quantize_q2_K(src + start, (char *) dst + start_row * row_size, nrows, n_per_row, imatrix); break;
        case GGML_TYPE_Q3_K:    result = quantize_q3_K(src + start, (char *) dst + start_row * row_size, nrows, n_per_row, imatrix); break;
        case GGML_TYPE_Q4_K:    result = quantize_q4_K(src + start, (char *) dst + start_row * row_size, nrows, n_per_row, imatrix); break;
        case GGML_TYPE_Q5_K:    result = quantize_q5_K(src + start, (char *) dst + start_row * row_size, nrows, n_per_row, imatrix); break;
        case GGML_TYPE_Q6_K:    result = quantize_q6_K(src + start, (char *) dst + start_row * row_size, nrows, n_per_row, imatrix); break;
        case GGML_TYPE_TQ1_0:   result = quantize_tq1_0(src + start, (char *) dst + start_row * row_size, nrows, n_per_row, imatrix); break;
        case GGML_TYPE_TQ2_0:   result = quantize_tq2_0(src + start, (char *) dst + start_row * row_size, nrows, n_per_row, imatrix); break;
        case GGML_TYPE_IQ2_XXS: result = quantize_iq2_xxs(src + start, (char *) dst + start_row * row_size, nrows, n_per_row, imatrix); break;
        case GGML_TYPE_IQ2_XS:  result = quantize_iq2_xs (src + start, (char *) dst + start_row * row_size, nrows, n_per_row, imatrix); break;
        case GGML_TYPE_IQ3_XXS: result = quantize_iq3_xxs(src + start, (char *) dst + start_row * row_size, nrows, n_per_row, imatrix); break;
        case GGML_TYPE_IQ3_S:   result = quantize_iq3_s  (src + start, (char *) dst + start_row * row_size, nrows, n_per_row, imatrix); break;
        case GGML_TYPE_IQ2_S:   result = quantize_iq2_s  (src + start, (char *) dst + start_row * row_size, nrows, n_per_row, imatrix); break;
        case GGML_TYPE_IQ1_S:   result = quantize_iq1_s  (src + start, (char *) dst + start_row * row_size, nrows, n_per_row, imatrix); break;
        case GGML_TYPE_IQ1_M:   result = quantize_iq1_m  (src + start, (char *) dst + start_row * row_size, nrows, n_per_row, imatrix); break;
        case GGML_TYPE_IQ4_NL:  result = quantize_iq4_nl (src + start, (char *) dst + start_row * row_size, nrows, n_per_row, imatrix); break;
        case GGML_TYPE_IQ4_XS:  result = quantize_iq4_xs (src + start, (char *) dst + start_row * row_size, nrows, n_per_row, imatrix); break;
        case GGML_TYPE_F16:
            {
                size_t elemsize = sizeof(ggml_fp16_t);
                ggml_fp32_to_fp16_row(src + start, (ggml_fp16_t *)dst + start, n);
                result = n * elemsize;
            } break;
        case GGML_TYPE_BF16:
            {
                size_t elemsize = sizeof(ggml_bf16_t);
                ggml_fp32_to_bf16_row_ref(src + start, (ggml_bf16_t *)dst + start, n);
                result = n * elemsize;
            } break;
        case GGML_TYPE_F32:
            {
                size_t elemsize = sizeof(float);
                result = n * elemsize;
                memcpy((uint8_t *)dst + start * elemsize, src + start, result);
            } break;
        default:
            assert(false);
    }

    GGML_ASSERT(result == nrows * row_size);

    // return the quantized size
    return result;
}

```