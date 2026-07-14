import { describe, it, expect, vi } from "vitest";
import { reconstructTrades } from "../positions";
import type { FillInput, RoundTripTrade } from "../types";

describe("Positions Reconstruction", () => {
  describe("reconstructTrades", () => {
    it("builds trades from fills with correct PnL calculation", () => {
      const fills: FillInput[] = [
        {
          tradeId: "fill1",
          orderId: "order1",
          symbol: "BTC/USDT",
          base: "BTC",
          quote: "USDT",
          market: "spot",
          side: "buy",
          price: 100,
          amount: 1,
          cost: 100,
          fee: 0.5,
          feeCurrency: "USDT",
          realizedPnl: null,
          takerOrMaker: "taker",
          timestamp: new Date("2024-01-01T10:00:00Z"),
          exchange: "binance",
          accountId: "acc1",
        },
        {
          tradeId: "fill2",
          orderId: "order2",
          symbol: "BTC/USDT",
          base: "BTC",
          quote: "USDT",
          market: "spot",
          side: "sell",
          price: 110,
          amount: 1,
          cost: 110,
          fee: 0.5,
          feeCurrency: "USDT",
          realizedPnl: null,
          takerOrMaker: "maker",
          timestamp: new Date("2024-01-02T10:00:00Z"),
          exchange: "binance",
          accountId: "acc1",
        },
      ];

      const trades = reconstructTrades(fills);

      expect(trades).toHaveLength(1);
      expect(trades[0].id).toBe("acc1:BTC/USDT:spot:1704103200000");
      expect(trades[0].symbol).toBe("BTC/USDT");
      expect(trades[0].qty).toBe(1);
      expect(trades[0].entryPrice).toBe(100);
      expect(trades[0].exitPrice).toBe(110);
      expect(trades[0].grossPnl).toBe(10); // (110 - 100) * 1, до вычета комиссий
      expect(trades[0].netPnl).toBe(9); // 10 - 1 комиссия (оба филла)
      expect(trades[0].result).toBe("win");
      expect(trades[0].fillCount).toBe(2);
    });

    it("handles multiple symbols in same account", () => {
      const fills: FillInput[] = [
        {
          tradeId: "fill1",
          orderId: "order1",
          symbol: "BTC/USDT",
          base: "BTC",
          quote: "USDT",
          market: "spot",
          side: "buy",
          price: 100,
          amount: 1,
          cost: 100,
          fee: 0.5,
          feeCurrency: "USDT",
          realizedPnl: null,
          takerOrMaker: "taker",
          timestamp: new Date("2024-01-01T10:00:00Z"),
          exchange: "binance",
          accountId: "acc1",
        },
        {
          tradeId: "fill2",
          orderId: "order2",
          symbol: "ETH/USDT",
          base: "ETH",
          quote: "USDT",
          market: "spot",
          side: "buy",
          price: 2000,
          amount: 0.5,
          cost: 1000,
          fee: 1,
          feeCurrency: "USDT",
          realizedPnl: null,
          takerOrMaker: "taker",
          timestamp: new Date("2024-01-01T11:00:00Z"),
          exchange: "binance",
          accountId: "acc1",
        },
        {
          tradeId: "fill3",
          orderId: "order3",
          symbol: "BTC/USDT",
          base: "BTC",
          quote: "USDT",
          market: "spot",
          side: "sell",
          price: 110,
          amount: 1,
          cost: 110,
          fee: 0.5,
          feeCurrency: "USDT",
          realizedPnl: null,
          takerOrMaker: "maker",
          timestamp: new Date("2024-01-02T10:00:00Z"),
          exchange: "binance",
          accountId: "acc1",
        },
        {
          tradeId: "fill4",
          orderId: "order4",
          symbol: "ETH/USDT",
          base: "ETH",
          quote: "USDT",
          market: "spot",
          side: "sell",
          price: 2100,
          amount: 0.5,
          cost: 1050,
          fee: 1,
          feeCurrency: "USDT",
          realizedPnl: null,
          takerOrMaker: "maker",
          timestamp: new Date("2024-01-02T11:00:00Z"),
          exchange: "binance",
          accountId: "acc1",
        },
      ];

      const trades = reconstructTrades(fills);

      expect(trades).toHaveLength(2);
      const btcTrade = trades.find(t => t.symbol === "BTC/USDT");
      const ethTrade = trades.find(t => t.symbol === "ETH/USDT");
      expect(btcTrade).toBeDefined();
      expect(ethTrade).toBeDefined();
      expect(btcTrade!.entryPrice).toBe(100);
      expect(ethTrade!.entryPrice).toBe(2000);
      expect(btcTrade!.exitPrice).toBe(110);
      expect(ethTrade!.exitPrice).toBe(2100);
    });

    it("handles partial fills with different prices", () => {
      const fills: FillInput[] = [
        {
          tradeId: "fill1",
          orderId: "order1",
          symbol: "BTC/USDT",
          base: "BTC",
          quote: "USDT",
          market: "spot",
          side: "buy",
          price: 100,
          amount: 0.5,
          cost: 50,
          fee: 0.25,
          feeCurrency: "USDT",
          realizedPnl: null,
          takerOrMaker: "taker",
          timestamp: new Date("2024-01-01T10:00:00Z"),
          exchange: "binance",
          accountId: "acc1",
        },
        {
          tradeId: "fill2",
          orderId: "order2",
          symbol: "BTC/USDT",
          base: "BTC",
          quote: "USDT",
          market: "spot",
          side: "buy",
          price: 101,
          amount: 0.5,
          cost: 50.5,
          fee: 0.25,
          feeCurrency: "USDT",
          realizedPnl: null,
          takerOrMaker: "taker",
          timestamp: new Date("2024-01-02T10:00:00Z"),
          exchange: "binance",
          accountId: "acc1",
        },
        {
          tradeId: "fill3",
          orderId: "order3",
          symbol: "BTC/USDT",
          base: "BTC",
          quote: "USDT",
          market: "spot",
          side: "sell",
          price: 105,
          amount: 1,
          cost: 105,
          fee: 0.5,
          feeCurrency: "USDT",
          realizedPnl: null,
          takerOrMaker: "taker",
          timestamp: new Date("2024-01-03T10:00:00Z"),
          exchange: "binance",
          accountId: "acc1",
        },
      ];

      const trades = reconstructTrades(fills);

      expect(trades).toHaveLength(1);
      expect(trades[0].qty).toBe(1);
      expect(trades[0].entryPrice).toBeCloseTo(100.5, 1); // Average of two buys
      expect(trades[0].exitPrice).toBe(105);
      expect(trades[0].grossPnl).toBeCloseTo((105 - 100.5) * 1, 2); // Price difference times quantity
    });

    it("returns empty array for insufficient fills", () => {
      const fills: NormalizedFill[] = [
        {
          tradeId: "fill1",
          orderId: "order1",
          symbol: "BTC/USDT",
          base: "BTC",
          quote: "USDT",
          market: "spot",
          side: "buy",
          price: 100,
          amount: 1,
          cost: 100,
          fee: 0.5,
          feeCurrency: "USDT",
          realizedPnl: null,
          takerOrMaker: "taker",
          timestamp: new Date("2024-01-01T10:00:00Z"),
          exchange: "binance",
          accountId: "acc1",
        },
        {
          tradeId: "fill2",
          orderId: "order2",
          symbol: "BTC/USDT",
          base: "BTC",
          quote: "USDT",
          market: "spot",
          side: "sell",
          price: 100.5,
          amount: 0.5, // Partial sell, not complete trade
          cost: 50.25,
          fee: 0.25,
          feeCurrency: "USDT",
          realizedPnl: null,
          takerOrMaker: "taker",
          timestamp: new Date("2024-01-02T10:00:00Z"),
          exchange: "binance",
          accountId: "acc1",
        },
      ];

      const trades = reconstructTrades(fills);

      expect(trades).toHaveLength(0);
    });
  });

  });