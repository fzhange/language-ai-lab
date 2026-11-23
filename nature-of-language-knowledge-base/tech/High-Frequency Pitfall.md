# `whether`：从「是否」到「无论哪种情况」

> [!example] 原句
> `defer wg.Done()` runs whenever worker returns, whether the return is explicit or implicit.
> `worker` 协程返回时，`defer wg.Done()` 都会执行；*无论* 这个返回是显式的还是隐式的

## 1 是否
> I don't know whether he will come.

## 2 无论 (让步)
> `defer wg.Done()` runs whenever worker returns, whether the return is explicit or implicit.

> [!info] 什么是「让步」？
> 语法里的「让步」不是日常生活中的妥协或退让。
> 它指的是：**先承认一个本来可能阻碍主句的情况，但主句结果照常成立。**
> 人话：**有障碍也照做**，就是“风雨无阻”。
> 可以把它理解为一个稳定性测试：
> ```text
> 情况改变：A  ──┐
>              ├── 主句结果仍然不变
> 情况改变：B  ──┘
> ```

| 结构                     | 变量和结果的关系              | 例句                                                |
| :--------------------- | :-------------------- | :------------------------------------------------ |
| `if`（条件）               | **条件成立，主句出现相应结果**      | `If it rains, we stay home.`<br>如果下雨，我们就待在家。       |
| `even if`（即使）          | **条件出现，也推不翻结果**       | `Even if it rains, we go out.`<br>即使下雨也出门。        |
| `whether A or B`（无论哪种） | **A、B 任一成立，主句结果都相同** | `Whether it rains or not, we go out.`<br>下不下雨都出门。 |

### 常见的让步引导结构

它们不全是同一种「词」，但都在表达：**障碍或变化存在，主句仍成立。**

| 障碍的范围 | 引导结构 | 例句 |
| :-- | :-- | :-- |
| 已经存在的事实 | `although` | `Although the server was slow, the request succeeded.`<br>虽然服务器很慢，请求还是成功了。 |
| 已经存在的事实 | `though` | `Though the test is small, it covers the critical path.`<br>虽然这个测试很小，它覆盖了关键路径。 |
| 已经存在的事实 | `even though` | `Even though the cache was empty, the page loaded quickly.`<br>尽管缓存为空，页面仍加载得很快。 |
| 假设的障碍 | `even if` | `Even if the retry fails, the worker will release the lock.`<br>即使重试失败，worker 仍会释放锁。 |
| 两种备选情况 | `whether A or B` | `Whether the return is explicit or implicit, the deferred function runs.`<br>返回是显式还是隐式，defer 函数都会执行。 |
| 两种备选情况 | `whether or not` | `Whether or not the client reconnects, the server keeps the session state.`<br>客户端是否重连，服务端都会保留会话状态。 |
| 不限定的情况、人、时间或地点 | `no matter + 疑问词` | `No matter what input arrives, the parser validates it first.`<br>无论传入什么输入，解析器都会先校验。 |
| 不限定的情况、人、时间或地点 | `疑问词 + ever` | `Whatever happens, the cleanup function must run.`<br>无论发生什么，清理函数都必须执行。 |
| 名词或动作本身构成的障碍 | `despite + 名词／-ing` | `Despite the network delay, the deployment completed.`<br>尽管网络有延迟，部署还是完成了。 |
| 名词或动作本身构成的障碍 | `in spite of + 名词／-ing` | `In spite of receiving an error, the job continued to the next item.`<br>尽管收到错误，任务仍继续处理下一项。 |

> [!warning] `if` 不属于让步
> `if` 引导条件句：如果条件成立，主句就会出现相应的结果；条件不成立时，主句怎样要看语境，`if` 本身不说。
>
> 让步结构则相反：即使这个情况出现，主句的结果仍然不变。

### 常见的条件句引导结构

条件句问的是：**前面的情况成立时，主句会怎样？** 不同结构改变的是「条件的类型」。

| 条件的类型 | 引导结构 | 核心逻辑 | 例句 |
| :-- | :-- | :-- | :-- |
| 普通条件 | `if` | 如果发生这个情况，主句会怎样 | `If the health check fails, the load balancer removes the instance.`<br>如果健康检查失败，负载均衡器会移除该实例。 |
| 普通条件 | `in the event that` | 以较正式的方式预设某种情况发生 | `In the event that the primary database fails, traffic switches to the replica.`<br>万一主数据库故障，流量会切换到副本。 |
| 反面条件 | `unless` | 「除非 A，否则 B」；通常可先理解为 `if ... not` | `Unless the token is valid, the API rejects the request.`<br>除非令牌有效，否则 API 会拒绝该请求。 |
| 许可或门槛 | `as long as` | 只要满足这个条件，主句就成立 | `You can deploy as long as all required checks pass.`<br>只要所有必需检查通过，你就可以部署。 |
| 许可或门槛 | `so long as` | 与 `as long as` 同样表示「只要」 | `The cache is safe so long as expired entries are refreshed.`<br>只要过期条目会被刷新，缓存就是安全的。 |
| 许可或门槛 | `provided (that)` | 强调一个明确的前提或约定 | `The migration is reversible, provided that the backup is complete.`<br>前提是备份完整，迁移就可以回滚。 |
| 许可或门槛 | `on condition that` | 明确设定一项必须遵守的条件 | `We will share the report on condition that sensitive fields are removed.`<br>条件是删除敏感字段，我们才会分享报告。 |
| 必要条件 | `only if` | 没有这个条件，主句不能成立 | `The worker starts only if it acquires the lease.`<br>只有拿到租约，worker 才会启动。 |
| 假设前提 | `assuming (that)` | 先假定这个情况，再讨论主句 | `Assuming that the input is valid, the function returns a result.`<br>假设输入有效，函数会返回结果。 |
| 假设前提 | `suppose` | 口语化地提出一个假设 | `Suppose the network drops halfway through the upload—what should the client do?`<br>假如上传到一半网络断开，客户端该怎么办？ |
| 假设前提 | `supposing (that)` | 与 `assuming` 相近，先建立讨论前提 | `Supposing that two users update the same record, how do we resolve the conflict?`<br>假设两个用户更新同一条记录，我们如何解决冲突？ |
| 时间触发 | `when` | 某个事件发生时，触发主句 | `When the request arrives, the handler checks the caller's identity.`<br>请求到达时，处理器会校验调用方身份。 |
| 时间触发 | `once` | 某个事件一完成，立即触发主句 | `Once the test finishes, the pipeline publishes the report.`<br>测试一结束，流水线就发布报告。 |
| 时间触发 | `whenever` | 事件每次发生时，都会触发主句 | `Whenever a worker returns, defer wg.Done() runs.`<br>worker 每次返回时，`defer wg.Done()` 都会执行。 |

> [!tip] 两个常混淆点
> - `if` 只说「如果下雨，就待在家」，**没有说**「不下雨就一定出门」。
> - `in case` 不是普通条件句，而是「提前防备」：`Take an umbrella in case it rains.`（带伞，以防下雨。）


## 容易混淆的边界

### `whether A or B` 不是 `either A or B`

两者都出现 A 和 B，但逻辑不同：

- `either A or B`：**从两个选项中选一个**。  
  `Choose either tea or coffee.` → 选茶或咖啡其中一个。
- `whether A or B`：**无须选择；两个情况都不影响结论**。  
  `Whether you choose tea or coffee, the price is the same.` → 选茶还是咖啡，价格都一样。

它更接近 `regardless of whether A or B`，而不是 `either A or B`。

