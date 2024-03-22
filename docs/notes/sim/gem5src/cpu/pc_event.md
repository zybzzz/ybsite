# pc_event 源码解析

主要是针对一个指定的 pc 值进行特殊的事件定义，这个事件应该不同于 gem5 本身的事件机制。

首先定义的是 `PCEventScope`：

```cpp
class PCEventScope
{
  public:
    virtual bool remove(PCEvent *event) = 0;
    virtual bool schedule(PCEvent *event) = 0;
};
```

这是一个虚函数，很显然是想对 `PCEvent` 提供接口，后续会有类对其进行具体的实现。

随后定义了 `PCEvent`：

```cpp
class PCEvent
{
  protected:
    std::string description;
    PCEventScope *scope;
    Addr evpc;

  public:
    PCEvent(PCEventScope *q, const std::string &desc, Addr pc);

    virtual ~PCEvent() { if (scope) remove(); }

    // for DPRINTF
    virtual const std::string name() const { return description; }

    std::string descr() const { return description; }
    Addr pc() const { return evpc; }

    bool remove();
    virtual void process(ThreadContext *tc) = 0;
};
```

可以看到的是 `PCEvent` 只是简单的记录了对于 `PCEvent` 的描述、`PCEvent` 对应的 pc 值，还有执行这个 `PCEvent` 的方法。

```cpp
inline
PCEvent::PCEvent(PCEventScope *s, const std::string &desc, Addr pc)
    : description(desc), scope(s), evpc(pc)
{
    scope->schedule(this);
}

inline bool
PCEvent::remove()
{
    if (!scope)
        panic("cannot remove an uninitialized event;");

    return scope->remove(this);
}
```

从后续文件中定义的两个内联函数可以看到，`PCEvent` 在创建的时候就会调用 scope 进行相关的调度。在 remove 的时候也是调用 scope 相关的方法。

后续定义了 `PCEventScope`，提供了很简单的队列抽象：

```cpp
class PCEventQueue : public PCEventScope
{
  protected:
    class MapCompare
    {
      public:
        bool
        operator()(PCEvent * const &l, PCEvent * const &r) const
        {
            return l->pc() < r->pc();
        }
        bool
        operator()(PCEvent * const &l, Addr pc) const
        {
            return l->pc() < pc;
        }
        bool
        operator()(Addr pc, PCEvent * const &r) const
        {
            return pc < r->pc();
        }
    };
    typedef std::vector<PCEvent *> Map;

  public:
    typedef Map::iterator iterator;
    typedef Map::const_iterator const_iterator;

  protected:
    typedef std::pair<iterator, iterator> range_t;
    typedef std::pair<const_iterator, const_iterator> const_range_t;

  protected:
    Map pcMap;

    bool doService(Addr pc, ThreadContext *tc);

  public:
    PCEventQueue();
    ~PCEventQueue();

    bool remove(PCEvent *event) override;
    bool schedule(PCEvent *event) override;
    bool service(Addr pc, ThreadContext *tc)
    {
        if (pcMap.empty())
            return false;

        return doService(pc, tc);
    }

    range_t equal_range(Addr pc);
    range_t equal_range(PCEvent *event) { return equal_range(event->pc()); }

    void dump() const;
};
```

这个类内部定义了 `MapCompare` 这个函数式的类，用来比较两个 `PCEvent`。后续定义了一个 vector 来抽象队列，定义了迭代器和迭代范围。后续出现了 `doService` 方法，这个方法很像从队列中选取相关的时间进行调度，后续又出现了 `service` 方法，这里面直接调用了 `doService` 方法。后续定义了`equal_range` 方法，这个方法看起来很像是给定一个 pc 值，返回所有值等同于 pc 值的 `PCEvent` 范围。至于 `dump` 从字面意思上理解，更有可能是将这个队列中的信息导出。

```cpp
class BreakPCEvent : public PCEvent
{
  protected:
    bool remove;

  public:
    BreakPCEvent(PCEventScope *s, const std::string &desc, Addr addr,
                 bool del = false);
    virtual void process(ThreadContext *tc);
};

class PanicPCEvent : public PCEvent
{
  public:
    PanicPCEvent(PCEventScope *s, const std::string &desc, Addr pc);
    virtual void process(ThreadContext *tc);
};
```

后续针对 `PCEvent` 实现了两个类的拓展，分别是 `BreakPCEvent` 和 `PanicPCEvent` 分别代表的是断点和遇到无法恢复错误的情况。

后续在 `cc` 文件中进行了一系列方法的实现。

```cpp
bool
PCEventQueue::remove(PCEvent *event)
{
    int removed = 0;
    range_t range = equal_range(event);
    iterator i = range.first;
    while (i != range.second && i != pcMap.end()) {
        if (*i == event) {
            DPRINTF(PCEvent, "PC based event removed at %#x: %s\n",
                    event->pc(), event->descr());
            i = pcMap.erase(i);
            ++removed;
        } else {
            i++;
        }
    }

    return removed > 0;
}
```

首先给出了队列 remove 相关事件的实现，可以看到 remove 相关的事件就是将这个事件 pc 值等同的全部事件进行移除，并对是否移除了相关的事件继续进行返回。

后续对队列的调度进行定义：

```cpp
bool
PCEventQueue::schedule(PCEvent *event)
{
    pcMap.push_back(event);
    std::sort(pcMap.begin(), pcMap.end(), MapCompare());

    DPRINTF(PCEvent, "PC based event scheduled for %#x: %s\n",
            event->pc(), event->descr());

    return true;
}
```

这里对调度的定义的是将一个事件插入到队列，这和 gem5 中的事件调度机制中对调度的定义很像。同 `PCEvent` 的构造函数联系起来， `PCEvent` 刚被创建的时候就被插入到了队列中，等待被 service。

```cpp
bool
PCEventQueue::doService(Addr pc, ThreadContext *tc)
{
    // Using the raw PC address will fail to break on Alpha PALcode addresses,
    // but that is a rare use case.
    int serviced = 0;
    range_t range = equal_range(pc);
    for (iterator i = range.first; i != range.second; ++i) {
        DPRINTF(PCEvent, "PC based event serviced at %#x: %s\n",
                (*i)->pc(), (*i)->descr());

        (*i)->process(tc);
        ++serviced;
    }

    return serviced > 0;
}
```

后续定义了队列的 `doService`，很显然，这将某一个 pc 时刻所有的事件都取出来执行了。

```cpp
void
PCEventQueue::dump() const
{
    const_iterator i = pcMap.begin();
    const_iterator e = pcMap.end();

    for (; i != e; ++i)
        cprintf("%d: event at %#x: %s\n", curTick(), (*i)->pc(),
                (*i)->descr());
}
```

`dump` 直接打印队列中的所有信息。

后续对 `BreakPCEvent` 和 `PanicPCEvent` 的实现很简单，主要是打断点和直接结束程序。

```cpp
BreakPCEvent::BreakPCEvent(PCEventScope *s, const std::string &desc, Addr addr,
                           bool del)
    : PCEvent(s, desc, addr), remove(del)
{
}

void
BreakPCEvent::process(ThreadContext *tc)
{
    StringWrap name("break_event");
    DPRINTFN("break event %s triggered\n", descr());
    debug::breakpoint();
    if (remove)
        delete this;
}

PanicPCEvent::PanicPCEvent(PCEventScope *s, const std::string &desc, Addr pc)
    : PCEvent(s, desc, pc)
{
}

void
PanicPCEvent::process(ThreadContext *tc)
{
    StringWrap name("panic_event");
    panic(descr());
}

```
