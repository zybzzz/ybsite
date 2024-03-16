# Simulating DRAM controllers for future system architecture exploration(ISPASS'14)

## Introduction

In this paper, the authors propose a DRAM simulation methodology that enables the simulation of DRAMs to be adapted to future architectures. With the development of parallel architectures, the power and performance of these systems are tightly coupled to the characteristics of the memory system. but nowadays some simulation studies only support simple DRAM models and limit the design space exploration. However, building an accurate DRAM controller model is non-trivial, due to a wide range of timing-related constraints and optimisation goals.

DRAM access patterns are varied, which is why today's trace-based simulators cannot accurately simulate them. Trace-based simulators often fail to capture system-wide information for simulation. The large amount of DRAM workload results in a large amount of time required to simulate DRAM, and thus the time to simulate becomes an important consideration for DRAM simulators.

Therefore the authors propose their their memory simulation model and integrate it into gem5. First, they show how focusing on the _controller_ rather than the memory allows them to build a high-performance event-based model. They demonstrate how DRAM behaviour is captured with high accuracy by only modeling the state transitions of the banks and the busses, thus enabling a fast, yet accurate model. Second, they compare the simulated behavior and performance with a state-of-the-art DRAM simulator. For a large number of benchmarks, they show that their model correlates well in terms of bandwidth and latency trends, and does so with a much-improved simulation performance and scalability. Lastly, they demonstrate how the proposed controller model is used as a valuable tool to study the impact of various future DRAMs on system performance.

## RATIONALE AND DESIGN

To study DRAM's impact on system power and performance, what the author needs to accomplish is described below:

1. a generic model to represent the model in the table.
2. balances the many timing constraints of the memory.
3. optimization goals and constraints of the transactions.
4. high simulation performance(lower time to use) with good accuracy.
5. the impact of various transactions on the performance of a computer system is revealed through the simulation of memory controllers.
6. how transactions are distributed across the memory controllers and routed through the interconnect.

For the 1, authors proposed generic controller model, just use three queues(read/write/response queue) to represent controller. To describe the organization of memory, this model provides the parameters in the table above for configuration. For the translation of memory addresses is done by the controller. For multi-channel Dram interaction is done by crossbar.


