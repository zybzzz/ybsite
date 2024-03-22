# callback.hh 源码解析

这里主要定义了对回调函数的实现。

```cpp
class CallbackQueue : public std::list<std::function<void()>>
{
  public:
    using Base = std::list<std::function<void()>>;

    using Base::Base;

    /**
     * @ingroup api_callback
     */
    void
    process()
    {
        for (auto &f: *this)
            f();
    }
};
```

这里主要实现的是把回调函数全塞到链表里面，然后再需要回调的时候直接一次性全部回调完。