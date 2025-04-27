# about ggml backend

About backend, memory allocation, compute graph, compute process. all ref the `simple-backend.cpp`.

## log

Need register log callback, and use macro like `GGML_DEBUG` to print log.

## device

device means what select decide to run the ggml. device init in the function like `ggml_backend_cpu_init`.
To init devide, user need do like:

```cpp
if(backend == cpu){
    ggml_backend_cpu_init();
}else if(backend == gpu){
    ggml_backend_gpu_init();
}else{
    // like this
}

```

In the cpu:

```cpp
ggml_backend_t ggml_backend_cpu_init(void) {
    // initialize CPU backend now to avoid slowing the first graph computation
    // This just allocate FP32 to FP16 Table
    ggml_cpu_init();

    struct ggml_backend_cpu_context * ctx = new ggml_backend_cpu_context;
    if (ctx == NULL) {
        return NULL;
    }

    // use how many thread to computer
    ctx->n_threads           = GGML_DEFAULT_N_THREADS;
    // the threadpool
    ctx->threadpool          = NULL;
    // this is a point to buffer, this buffer save the intermedicate
    // variable in the computer process.
    ctx->work_data           = NULL;
    // the buffer size
    ctx->work_size           = 0;
    // the callback of compute finish
    ctx->abort_callback      = NULL;
    ctx->abort_callback_data = NULL;

    ggml_backend_t cpu_backend = new ggml_backend {
        /* .guid      = */ ggml_backend_cpu_guid(),
        // this point to the cpu interface
        /* .interface = */ ggml_backend_cpu_i,
        // this point to the cpu device
        /* .device    = */ ggml_backend_reg_dev_get(ggml_backend_cpu_reg(), 0),
        /* .context   = */ ctx,
    };

    if (cpu_backend == NULL) {
        delete ctx;
        return NULL;
    }

    return cpu_backend;
}
```

`ggml_backend_reg_dev_get(ggml_backend_cpu_reg(), 0)` this point to the device.
device contains all the message about cpu.
        
```cpp
static const struct ggml_backend_reg_i ggml_backend_cpu_reg_i = {
    /* .get_name         = */ ggml_backend_cpu_reg_get_name,
    /* .get_device_count = */ ggml_backend_cpu_reg_get_device_count,
    /* .get_device       = */ ggml_backend_cpu_reg_get_device,
    /* .get_proc_address = */ ggml_backend_cpu_get_proc_address,
};

// this function just return the registered device.
ggml_backend_reg_t ggml_backend_cpu_reg(void) {
    // init CPU feature detection
    ggml_cpu_init();

    static struct ggml_backend_reg ggml_backend_cpu_reg = {
        /* .api_version = */ GGML_BACKEND_API_VERSION,
        /* .iface       = */ ggml_backend_cpu_reg_i,
        /* .context     = */ NULL,
    };

    return &ggml_backend_cpu_reg;
}
```
What important in cpu device is `ggml_backend_cpu_get_proc_address`, this contains the many extra information
about cpu, this function can return the function pointer, user can call this function pointer to get some information.

```cpp
static void * ggml_backend_cpu_get_proc_address(ggml_backend_reg_t reg, const char * name) {
    if (strcmp(name, "ggml_backend_set_n_threads") == 0) {
        ggml_backend_set_n_threads_t fct = ggml_backend_cpu_set_n_threads;
        return (void *)fct;
    }
    if (strcmp(name, "ggml_backend_dev_get_extra_bufts") == 0) {
        // this function in cpu is important, the extra matrix extension should use this
        ggml_backend_dev_get_extra_bufts_t fct = ggml_backend_cpu_device_get_extra_buffers_type;
        return (void *)fct;
    }
    if (strcmp(name, "ggml_backend_get_features") == 0) {
        return (void *)ggml_backend_cpu_get_features;
    }
    if (strcmp(name, "ggml_backend_set_abort_callback") == 0) {
        return (void *)ggml_backend_cpu_set_abort_callback;
    }
    if (strcmp(name, "ggml_backend_cpu_numa_init") == 0) {
        return (void *)ggml_numa_init;
    }
    if (strcmp(name, "ggml_backend_cpu_is_numa") == 0) {
        return (void *)ggml_is_numa;
    }

    // threadpool - TODO:  move to ggml-base
    if (strcmp(name, "ggml_threadpool_new") == 0) {
        return (void *)ggml_threadpool_new;
    }
    if (strcmp(name, "ggml_threadpool_free") == 0) {
        return (void *)ggml_threadpool_free;
    }
    if (strcmp(name, "ggml_backend_cpu_set_threadpool") == 0) {
        return (void *)ggml_backend_cpu_set_threadpool;
    }

    return NULL;

    GGML_UNUSED(reg);
}
```

all of that is about devide init.

## global ggml context

after the device registered, we should create global ggml context.

```cpp
struct ggml_init_params params {
        /*.mem_size   =*/ ggml_tensor_overhead() * num_tensors,
        /*.mem_buffer =*/ NULL,
        /*.no_alloc   =*/ true,
};

// create context
model.ctx = ggml_init(params);
```

ggml context don't have specific meaning in ggml, it just use to allocate some memory, so the ggml init 
will be call in some memory allocation case. The mem_size means the size the memory allocate want, no_alloc true means
backend devide allocate the real buffer, false means ggml allocate real buffer.

## new tensor object

```cpp
// create tensors
model.a = ggml_new_tensor_2d(model.ctx, GGML_TYPE_F32, cols_A, rows_A);
model.b = ggml_new_tensor_2d(model.ctx, GGML_TYPE_F32, cols_B, rows_B);
```

this just struct to save some config about tensor, no memory allocate.

## tensor memory allocate

```cpp
// create a backend buffer (backend memory) and alloc the tensors from the context
model.buffer = ggml_backend_alloc_ctx_tensors(model.ctx, model.backend);
```

this will call:

```cpp
ggml_backend_buffer_t ggml_backend_alloc_ctx_tensors(struct ggml_context * ctx, ggml_backend_t backend) {
    return ggml_backend_alloc_ctx_tensors_from_buft(ctx, ggml_backend_get_default_buffer_type(backend));
}
```

the `ggml_backend_buffer_t` meneage the backend device memory. Three have `ggml_backend_get_default_buffer_type` 
to determine with backend buffer type want to use. The most important is, if you want to use intel-amx and other
cpu specific matrix extensions, you must let `ggml_backend_get_default_buffer_type` to be the extension specific buffer.

`ggml_backend_get_default_buffer_type` this use device interface to return the buffer type:

```cpp
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

struct ggml_backend_buffer_type {
    struct ggml_backend_buffer_type_i  iface;
    ggml_backend_dev_t device;
    void * context;
};
```

the ggml_backend_buffer_type_i seems like a backend buffer allocator, the memory allocate by ggml_backend_buffer_type_i, and operate
in the ggml buffer type. The cpu extension implementer must care about this.

```cpp
ggml_backend_buffer_t ggml_backend_alloc_ctx_tensors_from_buft(struct ggml_context * ctx, ggml_backend_buffer_type_t buft) {
    GGML_ASSERT(ggml_get_no_alloc(ctx) == true);

    size_t alignment = ggml_backend_buft_get_alignment(buft);
    // see this, the max_size of the backend buffer defined by backend  
    size_t max_size = ggml_backend_buft_get_max_size(buft);

    ggml_backend_buffer_t * buffers = NULL;
    size_t n_buffers = 0;

    size_t cur_buf_size = 0;
    struct ggml_tensor * first = ggml_get_first_tensor(ctx);
    // access all the tensors in ggml context
    // it seems like the same ggml context can only do that once
    for (struct ggml_tensor * t = first; t != NULL; t = ggml_get_next_tensor(ctx, t)) {
        size_t this_size = 0;
        // calculate this tensor need how many size
        if (t->data == NULL && t->view_src == NULL) {
            this_size = GGML_PAD(ggml_backend_buft_get_alloc_size(buft, t), alignment);
        }

        if (cur_buf_size > 0 && (cur_buf_size + this_size) > max_size) {
            // per buffer size need < max buffer size
            // allocate tensors in the current buffer
            // the alloc_tensor_range allocate the memory
            if (!alloc_tensor_range(ctx, first, t, buft, cur_buf_size, &buffers, &n_buffers)) {
                return NULL;
            }
            first = t;
            cur_buf_size = this_size;
        } else {
            cur_buf_size += this_size;
        }
    }

    // allocate remaining tensors
    if (cur_buf_size > 0) {
        if (!alloc_tensor_range(ctx, first, NULL, buft, cur_buf_size, &buffers, &n_buffers)) {
            return NULL;
        }
    }

    if (n_buffers == 0) {
#ifndef NDEBUG
        GGML_LOG_DEBUG("%s: all tensors in the context are already allocated\n", __func__);
#endif
        return NULL;
    }

    ggml_backend_buffer_t buffer;
    if (n_buffers == 1) {
        buffer = buffers[0];
    } else {
        // n_buffers copy to ctx
        // this also copy 
        buffer = ggml_backend_multi_buffer_alloc_buffer(buffers, n_buffers);
    }
    free(buffers);
    return buffer;
}
```

### alloc_tensor_range

```cpp
static bool alloc_tensor_range(struct ggml_context * ctx,
        struct ggml_tensor * first, struct ggml_tensor * last,
        ggml_backend_buffer_type_t buft, size_t size,
        ggml_backend_buffer_t ** buffers, size_t * n_buffers) {

    // the allocate backend buffer in there
    // use the buffer type method to allocate buffer
    ggml_backend_buffer_t buffer = ggml_backend_buft_alloc_buffer(buft, size);
    if (buffer == NULL) {
        GGML_LOG_ERROR("%s: failed to allocate %s buffer of size %zu\n", __func__, ggml_backend_buft_name(buft), size);
        free_buffers(buffers, n_buffers);
        return false;
    }

    // add buffer to buffers array
    *buffers = realloc(*buffers, sizeof(ggml_backend_buffer_t) * (*n_buffers + 1));
    (*buffers)[(*n_buffers)++] = buffer;

    // simplely thinking, tallocr use ggml_backend_buffer_t to allocate memory for tensor
    struct ggml_tallocr tallocr = ggml_tallocr_new(buffer);

    for (struct ggml_tensor * t = first; t != last; t = ggml_get_next_tensor(ctx, t)) {
        enum ggml_status status = GGML_STATUS_SUCCESS;
        if (t->data == NULL) {
            if (t->view_src == NULL) {
                // no src, true allocate
                status = ggml_tallocr_alloc(&tallocr, t);
            } else if (t->buffer == NULL) {
                // have src, just a view
                status = ggml_backend_view_init(t);
            }
        } else {
            if (t->view_src != NULL && t->buffer == NULL) {
                // view of a pre-allocated tensor
                status = ggml_backend_view_init(t);
            }
        }
        if (status != GGML_STATUS_SUCCESS) {
            GGML_LOG_ERROR("%s: failed to initialize tensor %s\n", __func__, t->name);
            free_buffers(buffers, n_buffers);
            return false;
        }
    }

    return true;
}
```

also should care about that, both new and view will all call the init interface in ggml_backend_buffer_t.

```cpp
ggml_backend_buffer_t ggml_backend_multi_buffer_alloc_buffer(ggml_backend_buffer_t * buffers, size_t n_buffers) {
    ggml_backend_multi_buffer_context * ctx = (ggml_backend_multi_buffer_context *) malloc(sizeof(struct ggml_backend_multi_buffer_context));
    ctx->n_buffers = n_buffers;
    ctx->buffers = (ggml_backend_buffer_t *) malloc(n_buffers * sizeof(ggml_backend_buffer_t));

    GGML_ASSERT(ctx->buffers != NULL);

    size_t total_size = 0;
    for (size_t i = 0; i < n_buffers; i++) {
        ctx->buffers[i] = buffers[i];
        total_size += ggml_backend_buffer_get_size(buffers[i]);
    }

    return ggml_backend_buffer_init(buffers[0]->buft, ggml_backend_multi_buffer_i, ctx, total_size);
}
```

if more than one backend buffer use, thay will be save in ggml_backend_multi_buffer_context, return the ggml_backend_buffer_t,
this ggml_backend_buffer_t merge this message.

