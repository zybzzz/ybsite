# 树状数组

树状数组实际上是对前缀和和差分问题的优化，如果前缀和和差分问题想要快速的在 `[l, r]` 区间之内进行求前缀和需要的时间复杂度是 N 相关的，但是树状数组能够把这个时间复杂度优化成 logN 相关。但是前缀和本身 build 初始化的时候是 o(1) 的，树状数组 build 的时候也是 log N 的。

## 核心函数

模版，来自 acwing y总。

```cpp
#include <cstdio>
#include <cstring>
#include <iostream>
#include <algorithm>

using namespace std;

typedef long long LL;

const int N = 100010;

int n, m;
int a[N];
LL tr1[N];  // 维护b[i]的前缀和
LL tr2[N];  // 维护b[i] * i的前缀和

int lowbit(int x)
{
    return x & -x;
}

void add(LL tr[], int x, LL c)
{
    for (int i = x; i <= n; i += lowbit(i)) tr[i] += c;
}

LL sum(LL tr[], int x)
{
    LL res = 0;
    for (int i = x; i; i -= lowbit(i)) res += tr[i];
    return res;
}

LL prefix_sum(int x)
{
    return sum(tr1, x) * (x + 1) - sum(tr2, x);
}

int main()
{
    scanf("%d%d", &n, &m);
    for (int i = 1; i <= n; i ++ ) scanf("%d", &a[i]);
    for (int i = 1; i <= n; i ++ )
    {
        int b = a[i] - a[i - 1];
        add(tr1, i, b);
        add(tr2, i, (LL)b * i);
    }

    while (m -- )
    {
        char op[2];
        int l, r, d;
        scanf("%s%d%d", op, &l, &r);
        if (*op == 'Q')
        {
            printf("%lld\n", prefix_sum(r) - prefix_sum(l - 1));
        }
        else
        {
            scanf("%d", &d);
            // a[l] += d
            add(tr1, l, d), add(tr2, l, l * d);
            // a[r + 1] -= d
            add(tr1, r + 1, -d), add(tr2, r + 1, (r + 1) * -d);
        }
    }

    return 0;
}

//作者：yxc
//链接：https://www.acwing.com/activity/content/code/content/164758/
//来源：AcWing
//著作权归作者所有。商业转载请联系作者获得授权，非商业转载请注明出处。
```

模版的核心是 lowerbit，add, sum 函数。可以想象树状数组提供的接口是和本身的原始数组相似的，用的时候就当成正常前缀和提供的接口去用就行，是底层的实现有所区别。add 实际上保证改动某一个值的时候，所有数组中所有求和时候依赖于这个值的都进行更新，sum 实际上就是手机所有相关的依赖数据并进行相加。

如果正常的build数组，直接向指定位置插入元素就行，然后想求和的时候调用 sum。

如果是想利用差分，在初始化的时候有两种方法，第一种就是只设置某个位置的值为 `a[i] - a[i - 1]`。第二种就是跟常规差分一样的做法，在i位置 `+a[i]` 在 i - 1 位置减 `a[i - 1]`，这种操作在常规的差分中和常见，因为常规差分提供的接口就是这种方式的接口。但是由于树状数组中接口是分离的，两种方法都能进行使用。

如果树状数组中记录的是差分，那我们很快能通过 sum 求出原数组 a 在某一点的值。但是题目有时候想要要求求出原数组在 `[l, r]` 之间的和，等于是还想求原数组的前缀和，这时候就要开两个树状数组，就跟上面的模版一样。

## 局限

原始数组的方法只适合对区间不做修改，只做查询的情况。树状数组适合频繁做修改查询前缀和的情况。如果要求区间最大值等等就要用线段树了。