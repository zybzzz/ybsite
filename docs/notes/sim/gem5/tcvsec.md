# ThreadContext 与 ExecContext 进行对比

ThreadContext 和 ExecContext 都是访问 cpu 的接口，区别在于 ExecContext 是提供给 ISA 的各个指令访问 cpu 的，而 ThreadContext 是提供给其他组件去访问 cpu 的状态的。因此 ExecContext 由各个 ISA 独立做实现，因为各个 ISA 所需要的 cpu 状态大不相同。而 ThreadContext 是由 cpu 去做实现的，它由各个 cpu 去实现，提供给各个组件统一访问各种类型 cpu 的接口。
