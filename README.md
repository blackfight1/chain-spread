# 跨链同币监控

比较同一枚币在 Solana、BNB Chain、Base、Arbitrum、Polygon、Optimism 上的池子价格，计算扣掉 Gas 和安全垫之后的净收益。第一版只监控，不保存私钥，也不发送交易。

代币是否为同一枚，用 LI.FI 的 `coinKey` 判断。同名但不是同一资产的币不会放在一起比。池子价格来自 DexScreener。净收益超过门槛时，用 Jupiter（Solana）或 LI.FI（EVM）再要一次可成交报价。

## 本地运行

```bash
npm install
npm run dev
```

浏览器打开 `http://127.0.0.1:3847`。

页面有四个标签：机会、行情、档案、设置。默认开启 Solana、BNB Chain、Base、Arbitrum。Polygon 和 Optimism 可以在设置里打开。

扫描结果写在 `data/monitor.sqlite`，这个文件不会提交。
