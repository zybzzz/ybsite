# ActivityRecorder

这个类封装的很奇怪，既可以表示 cpu 在某段事件内是否活动，又能表示各个阶段的活动情况。

## cpu

对于 cpu，在 activateStage 中：

```cpp
void
ActivityRecorder::activity()
{
    // 如果已经激活过 直接返回
    if (activityBuffer[0]) {
        return;
    }

    // 没有激活过 进行激活
    activityBuffer[0] = true;

    // 增加活动数
    ++activityCount;

    DPRINTF(Activity, "Activity: %i\n", activityCount);
}
```

而在 advance 中：

```cpp
void
ActivityRecorder::advance()
{ 
    // 随着 advance，会将激活数减到0
    if (activityBuffer[-longestLatency]) {
        --activityCount;

        assert(activityCount >= 0);

        DPRINTF(Activity, "Activity: %i\n", activityCount);

        if (activityCount == 0) {
            DPRINTF(Activity, "No activity left!\n");
        }
    }

    activityBuffer.advance();
}
```

在某段时间内激活数为 0 的时候直接代表不工作。

## 对于阶段而言

阶段就是直接进行计数，没有使用 TimeBuffer，各个阶段是否激活的 bool 和 激活数来判断各个阶段是否激活。

## 使用

两者可以独自用，也可以单独用。
