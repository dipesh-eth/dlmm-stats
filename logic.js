import fetch from 'node-fetch';

const DEFAULT_BASE_URL = 'https://dlmm.datapi.meteora.ag';
const MAX_CONCURRENT_REQUESTS = 5;

function toNumber(value, fallback = 0) {
  if (value === undefined || value === null || value === '') return fallback;
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

function unixToIso(seconds) {
  if (!seconds) return null;
  return new Date(Number(seconds) * 1000).toISOString();
}

function ageFromUnix(seconds) {
  if (!seconds) return { age: 0, ageHour: 0 };
  const ageHour = Math.max(0, (Date.now() - Number(seconds) * 1000) / 36e5);
  return { age: Math.floor(ageHour / 24), ageHour };
}

function tokenPairTotal(pair, key = 'usd') {
  return toNumber(pair?.total?.[key]);
}

function tokenAmount(pair, side) {
  return toNumber(pair?.[side]?.amount);
}

function sumUnclaimed(unrealized, key = 'usd') {
  if (!unrealized) return 0;
  return [
    unrealized.unclaimedFeeTokenX,
    unrealized.unclaimedFeeTokenY,
    unrealized.unclaimedRewardTokenX,
    unrealized.unclaimedRewardTokenY,
  ].reduce((total, item) => total + toNumber(item?.[key]), 0);
}

function collectPoolAddresses(portfolioResponse) {
  return unique((portfolioResponse?.pools || []).map(pool => pool.poolAddress || pool.pool_address));
}

class MeteoraClient {
  constructor(_apiKey = null, options = {}) {
    this.baseUrl = (options.baseUrl || process.env.METEORA_API_BASE || DEFAULT_BASE_URL).replace(/\/$/, '');
    this.activeRequests = 0;
    this.queue = [];
  }

  async runQueued(task) {
    if (this.activeRequests >= MAX_CONCURRENT_REQUESTS) {
      await new Promise(resolve => this.queue.push(resolve));
    }

    this.activeRequests += 1;
    try {
      return await task();
    } finally {
      this.activeRequests -= 1;
      const next = this.queue.shift();
      if (next) next();
    }
  }

  async makeRequest(endpoint, params = {}) {
    return this.runQueued(async () => {
      const url = new URL(`${this.baseUrl}${endpoint}`);
      Object.entries(params).forEach(([key, value]) => {
        if (value !== undefined && value !== null && value !== '') {
          url.searchParams.set(key, value);
        }
      });

      const response = await fetch(url.toString(), { method: 'GET' });
      const body = await response.text();
      let data = null;

      try {
        data = body ? JSON.parse(body) : null;
      } catch {
        data = body;
      }

      if (!response.ok) {
        const detail = typeof data === 'string' ? data : JSON.stringify(data);
        throw new Error(`Meteora API Error ${response.status} ${response.statusText}: ${detail}`);
      }

      return data;
    });
  }

  async getPool(poolAddress) {
    return this.makeRequest(`/pools/${poolAddress}`);
  }

  async getPoolPositionPnl(poolAddress, wallet, options = {}) {
    return this.makeRequest(`/positions/${poolAddress}/pnl`, {
      user: wallet,
      status: options.status || 'all',
      page: options.page || 1,
      page_size: options.pageSize || options.page_size || 100,
    });
  }

  async getPositionLogs(options = {}) {
    if (!options.position && !options.address) {
      throw new Error('getPositionLogs requires a position address');
    }
    return this.makeRequest(`/positions/${options.position || options.address}/historical`, {
      event_type: options.eventType || options.event_type,
      order_direction: options.orderDirection || options.order_direction,
    });
  }

  async getOpenPositions(wallet) {
    const pools = await this.fetchPortfolioPools('/portfolio/open', wallet);
    const positionsByPool = await Promise.all(pools.map(async pool => {
      const poolAddress = pool.poolAddress;
      if (!poolAddress) return [];

      const pnlResponse = await this.getPoolPositionPnl(poolAddress, wallet, {
        status: 'open',
        page: 1,
        pageSize: 100,
      });

      return (pnlResponse?.positions || []).map(position =>
        this.normalizePosition(position, {
          wallet,
          pool,
          pnlResponse,
          status: 'open',
        })
      );
    }));

    const positions = positionsByPool.flat();
    return { count: positions.length, data: positions };
  }

  async getHistoricalPositions(wallet, options = {}) {
    const page = Math.max(1, toNumber(options.page, 1));
    const pageSize = Math.max(1, toNumber(options.pageSize, 10));
    const pools = await this.fetchPortfolioPools('/portfolio', wallet);
    const positions = await this.fetchPositionsForPools(pools, wallet, 'closed');
    positions.sort((a, b) => toNumber(b.closeAtUnix) - toNumber(a.closeAtUnix));

    const totalCount = positions.length;
    const totalPages = Math.max(1, Math.ceil(totalCount / pageSize));
    const start = (page - 1) * pageSize;

    return {
      data: {
        data: positions.slice(start, start + pageSize),
        pagination: {
          currentPage: page,
          totalPages,
          totalCount,
          pageSize,
        },
      },
    };
  }

  async getOverview(wallet) {
    const [totals, openPortfolio, closedPortfolio] = await Promise.all([
      this.makeRequest('/portfolio/total', { user: wallet }).catch(() => null),
      this.makeRequest('/portfolio/open', { user: wallet, page: 1, page_size: 50 }).catch(() => null),
      this.makeRequest('/portfolio', { user: wallet, page: 1, page_size: 50 }).catch(() => null),
    ]);

    const closedPools = closedPortfolio?.hasNext
      ? await this.fetchPortfolioPools('/portfolio', wallet)
      : closedPortfolio?.pools || [];
    const closedPositions = await this.fetchPositionsForPools(closedPools, wallet, 'closed');
    const winLp = closedPositions.filter(pos => toNumber(pos.pnl?.value) > 0).length;
    const closedCount = toNumber(totals?.totalClosedPositions, closedPositions.length);
    const openCount = toNumber(openPortfolio?.totalPositions);
    const avgAgeHour = closedPositions.length
      ? closedPositions.reduce((sum, pos) => sum + toNumber(pos.ageHour), 0) / closedPositions.length
      : 0;

    const totalPnlUsd = toNumber(totals?.totalPnlUsd);
    const totalFeeUsd = closedPositions.reduce((sum, pos) => sum + toNumber(pos.collectedFee), 0);
    const totalInflow = closedPositions.reduce((sum, pos) => sum + toNumber(pos.inputValue), 0);
    const totalOutflow = closedPositions.reduce((sum, pos) => sum + tokenPairTotal(pos.raw?.allTimeWithdrawals), 0);

    return {
      data: {
        owner: wallet,
        chain: 'solana',
        protocol: 'meteora',
        total_pnl: { ALL: totalPnlUsd, '7D': 0, '1M': 0, '3M': 0 },
        total_fee: { ALL: totalFeeUsd, '7D': 0, '1M': 0, '3M': 0 },
        total_inflow: totalInflow,
        total_outflow: totalOutflow,
        win_rate: { ALL: closedCount ? winLp / closedCount : 0 },
        win_lp: winLp,
        closed_lp: { ALL: closedCount },
        opening_lp: openCount,
        total_lp: openCount + closedCount,
        total_pool: unique([...collectPoolAddresses(openPortfolio), ...collectPoolAddresses(closedPortfolio)]).length,
        roi: totalInflow ? totalPnlUsd / totalInflow : toNumber(totals?.totalPnlPctChange) / 100,
        avg_age_hour: avgAgeHour,
        updated_at: new Date().toISOString(),
      },
    };
  }

  async getPositionDetails(positionId, options = {}) {
    const wallet = options.wallet || options.owner;
    if (!wallet) {
      const error = new Error('Meteora requires wallet context for position PnL. Use `/register_wallet` or pass wallet.');
      error.code = 'NO_WALLET';
      throw error;
    }

    const logs = await this.getPositionLogs({ position: positionId, order_direction: 'desc' });
    const poolAddress = logs?.events?.find(event => event.poolAddress)?.poolAddress;

    if (!poolAddress) {
      return { data: null };
    }

    const [pnlResponse, poolDetails] = await Promise.all([
      this.getPoolPositionPnl(poolAddress, wallet, {
        status: 'all',
        page: 1,
        pageSize: 100,
      }),
      this.getPool(poolAddress).catch(() => null),
    ]);

    const position = (pnlResponse?.positions || []).find(item => item.positionAddress === positionId);
    if (!position) return { data: null };

    return {
      data: this.normalizePosition(position, {
        wallet,
        pool: this.poolDetailsToContext(poolDetails, poolAddress),
        pnlResponse,
        historicalEvents: logs?.events || [],
      }),
    };
  }

  async fetchPortfolioPools(endpoint, wallet) {
    const pools = [];
    let page = 1;
    let hasNext = true;

    while (hasNext) {
      const response = await this.makeRequest(endpoint, {
        user: wallet,
        page,
        page_size: 50,
      });

      pools.push(...(response?.pools || []));
      hasNext = Boolean(response?.hasNext);
      page += 1;
    }

    return pools;
  }

  async fetchPositionsForPools(pools, wallet, status) {
    const positionsByPool = await Promise.all(pools.map(async pool => {
      const poolAddress = pool.poolAddress;
      if (!poolAddress) return [];

      const allPositions = [];
      let page = 1;
      let hasNext = true;

      while (hasNext) {
        const pnlResponse = await this.getPoolPositionPnl(poolAddress, wallet, {
          status,
          page,
          pageSize: 100,
        });

        allPositions.push(...(pnlResponse?.positions || []).map(position =>
          this.normalizePosition(position, { wallet, pool, pnlResponse, status })
        ));

        hasNext = Boolean(pnlResponse?.hasNext);
        page += 1;
      }

      return allPositions;
    }));

    return positionsByPool.flat();
  }

  normalizePosition(position, context = {}) {
    const pool = context.pool || {};
    const pnlResponse = context.pnlResponse || {};
    const unrealized = position.unrealizedPnl || null;
    const status = position.isClosed ? 'Closed' : 'Open';
    const createdAtUnix = toNumber(position.createdAt);
    const closeAtUnix = toNumber(position.closedAt);
    const { age, ageHour } = ageFromUnix(createdAtUnix);
    const price0 = toNumber(pnlResponse.tokenXPrice || pool.tokenXPrice || pool.price0);
    const price1 = toNumber(pnlResponse.tokenYPrice || pool.tokenYPrice || pool.price1);
    const solPrice = toNumber(pnlResponse.solPrice || pool.solPrice);
    const pnlUsd = toNumber(position.pnlUsd ?? pool.pnl);
    const pnlSol = position.pnlSol !== null && position.pnlSol !== undefined
      ? toNumber(position.pnlSol)
      : solPrice ? pnlUsd / solPrice : 0;
    const collectedFeeUsd = tokenPairTotal(position.allTimeFees, 'usd');
    const collectedFeeSol = tokenPairTotal(position.allTimeFees, 'sol');
    const unCollectedFeeUsd = sumUnclaimed(unrealized, 'usd');
    const unCollectedFeeSol = sumUnclaimed(unrealized, 'amountSol');
    const outOfRange = position.isOutOfRange ?? pool.outOfRange ?? pool.positionsOutOfRange > 0;

    return {
      protocol: 'meteora',
      owner: context.wallet,
      poolAddress: pool.poolAddress || pool.pool_address,
      position: position.positionAddress,
      tokenName0: pool.tokenX || pool.token_x?.symbol || 'Token X',
      tokenName1: pool.tokenY || pool.token_y?.symbol || 'Token Y',
      price0,
      price1,
      currentValue: toNumber(unrealized?.balances, tokenPairTotal(position.allTimeWithdrawals, 'usd')),
      inputValue: tokenPairTotal(position.allTimeDeposits, 'usd'),
      inputNative: tokenPairTotal(position.allTimeDeposits, 'sol'),
      current: {
        amount0Adjusted: unrealized ? tokenAmount(unrealized, 'balanceTokenX') : tokenAmount(position.allTimeWithdrawals, 'tokenX'),
        amount1Adjusted: unrealized ? tokenAmount(unrealized, 'balanceTokenY') : tokenAmount(position.allTimeWithdrawals, 'tokenY'),
      },
      pnl: {
        value: pnlUsd,
        percent: toNumber(position.pnlPctChange ?? pool.pnlPctChange),
        valueNative: pnlSol,
        percentNative: toNumber(position.pnlSolPctChange ?? position.pnlPctChange ?? pool.pnlSolPctChange ?? pool.pnlPctChange),
      },
      collectedFee: collectedFeeUsd,
      collectedFeeNative: collectedFeeSol,
      unCollectedFee: unCollectedFeeUsd,
      unCollectedFeeNative: unCollectedFeeSol,
      priceRange: [toNumber(position.minPrice), toNumber(position.maxPrice)],
      range: [toNumber(position.lowerBinId), toNumber(position.upperBinId), toNumber(position.poolActiveBinId)],
      poolInfo: {
        tickSpacing: toNumber(pool.binStep || pool.bin_step),
        fee: toNumber(pool.baseFee || pool.fee_pct),
      },
      inRange: !outOfRange,
      age,
      ageHour,
      createdAt: unixToIso(createdAtUnix),
      closeAt: unixToIso(closeAtUnix),
      closeAtUnix,
      status,
      raw: position,
    };
  }

  poolDetailsToContext(poolDetails, poolAddress) {
    if (!poolDetails) return { poolAddress };

    return {
      poolAddress,
      binStep: poolDetails.pool_config?.bin_step,
      baseFee: poolDetails.pool_config?.base_fee_pct ?? poolDetails.dynamic_fee_pct,
      tokenX: poolDetails.token_x?.symbol,
      tokenY: poolDetails.token_y?.symbol,
      tokenXPrice: poolDetails.token_x?.price,
      tokenYPrice: poolDetails.token_y?.price,
    };
  }
}

export default MeteoraClient;
