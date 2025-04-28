# include header files/source file in ggml

include file in ggml distribute in different dirs, as a library `include` expose to the user,
other header file use internel.

## includes

1. `ggml-alloc.h`: about tensor and compute graph allocation, also include define of backend buffer and talloc.
2. `ggml-backend.h`: about all of backend, dev/buffer type/buffer/graph and so on. Also include some api can register
some event and do schedule.
3. `ggml-cpp.h`: include some cpp helper define.
4. `ggml.h`: include all the basic of ggml. aboutr macro, helper, data type, log, kernel op, all you want in this file.
5. `ggml-opt.h`: include some api about backend train.
6. `ggml-gguf.h`: something about gguf format design.
7. `ggml-cpu.h`: something about cpu backend api.

## src include

the src include is internel ggml use.

1. `ggml-backend-impl.h`: direct how the backend implement, also include buffer type/buffer struct and so on.
2. `ggml-impl.h`: direct how the kernel op and compute implement, also include some fp convert function. 
3. `ggml-quants.h`: include some quantize api.
4. `ggml-threads.h`: include some threads api, just barrier.
5. `ggml-common.h`: quantize data type struct define in this.

## src/ggml-cpu include 

1. `binary-ops.h`,`unary-ops.h` and `ops.h`: different type kernel ops api define.
2. `vec.h`: some vec op and vec helper.
3. `simd-mapping.h`: abstract different arch's simd, risc-v not in it.
4. `ggml-cpu-traits.h`: extra traits define for cpu, use for extension such like amx.
5. `ggml-cpu-quants.h`: cpu quantize function define, include normal quantize and vector.
6. `ggml-cpu-impl.h`: some arch specific data type define, some vector type abstract, and cpu
computer param struct define there.
7. `commom.h`: some fp converter function.


## src

1. `ggml-alloc.c`: alloc inplemention, internel struct include galloc/tdynalloc define here.
2. `ggml-backend.cpp`: backend api implement, **it is strange cpu backend buffer implement in here**, maybe because
cpu backend seen as default backend.
3. `ggml-backend-reg.cpp`: aboue backend device register.
4. `ggml-opt.cpp`: something about model opt.
5. `ggml-quants.c`: quants implement.
6. `ggml.c`: general function implement.

## src/ggml-cpu

1. `ggml-cpu.c`: all cpu compute implement here, about forward compute and so on.
2. `ggml-cpu.cpp`: cpu backend implement, not include buffer, include device compute and so on.
3. `ggml-cpu-traits.cpp`: extra traits detect and use, include extra buffer and work size.
4. `ops.cpp` and `binary-ops.cpp`: op implement.
5. `vec.cpp`: vec implement.
6. `ggml-cpu-quants`: also quants implement.



