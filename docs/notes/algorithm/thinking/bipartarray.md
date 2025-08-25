# 二分图

实际上是通过深度优先搜索的方式，避免同一个格子染上相同的颜色。

```cpp
void add(int a, int b)
{
    e[idx] = b, ne[idx] = h[a], h[a] = idx ++ ;
}

bool dfs(int u, int c)
{
    color[u] = c;

    for (int i = h[u]; i != -1; i = ne[i])
    {
        int j = e[i];
        if (!color[j])
        {
            if (!dfs(j, 3 - c)) return false;
        }
        else if (color[j] == c) return false;
    }

    return true;
}

//作者：yxc
//链接：https://www.acwing.com/activity/content/code/content/48778/
//来源：AcWing
//著作权归作者所有。商业转载请联系作者获得授权，非商业转载请注明出处。
```

核心思想是没颜色的进行染色，染上颜色的一定要确保染上的颜色一样，仅此。