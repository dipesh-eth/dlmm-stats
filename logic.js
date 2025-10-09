import fetch from 'node-fetch';

class LPAgentClient {
  constructor(apiKey) {
    this.apiKey = apiKey;
    this.baseUrl = 'https://api.lpagent.io/open-api/v1';
  }

  /**
   * Make API request with proper headers
   */
  async makeRequest(endpoint, params = {}) {
    const url = new URL(`${this.baseUrl}${endpoint}`);
    
    // Add query parameters
    Object.keys(params).forEach(key => {
      if (params[key] !== undefined && params[key] !== null) {
        url.searchParams.append(key, params[key]);
      }
    });

    try {
      const response = await fetch(url.toString(), {
        method: 'GET',
        headers: {
          'x-api-key': this.apiKey,
          'Content-Type': 'application/json'
        }
      });

      if (!response.ok) {
        throw new Error(`API Error: ${response.status} ${response.statusText}`);
      }

      return await response.json();
    } catch (error) {
      console.error('Request failed:', error);
      throw error;
    }
  }

  /**
   * Get opening (active) LP positions for a wallet
   */
  async getOpenPositions(owner) {
    return await this.makeRequest('/lp-positions/opening', { owner });
  }

  /**
   * Get historical (closed) LP positions for a wallet
   */
  async getHistoricalPositions(owner, options = {}) {
    const params = {
      owner,
      ...options // Can include: startDate, endDate, page, pageSize
    };
    return await this.makeRequest('/lp-positions/historical', params);
  }

  /**
   * Get overview metrics for a wallet
   */
  async getOverview(owner, protocol = null) {
    const params = { owner };
    if (protocol) params.protocol = protocol;
    return await this.makeRequest('/lp-positions/overview', params);
  }

  /**
   * Get detailed information for a specific position
   */
  async getPositionDetails(positionId) {
    return await this.makeRequest('/lp-positions/position', { position: positionId });
  }

  /**
   * Get logs for positions
   */
  async getPositionLogs(options = {}) {
    return await this.makeRequest('/lp-positions/logs', options);
  }

  // === FORMATTED OUTPUT METHODS ===

  /**
   * Format open positions for display
   */
  formatOpenPositions(data) {
    if (!data || !data.data || data.data.length === 0) {
      return 'No open positions found.';
    }

    let output = `📊 **Open Positions (${data.count})**\n\n`;

    data.data.forEach((pos, idx) => {
      const pnlSign = pos.pnl.percent >= 0 ? '📈' : '📉';
      const pnlColor = pos.pnl.percent >= 0 ? '+' : '';
      const uncollectedFee = parseFloat(pos.unCollectedFee || 0);
      
      output += `**${idx + 1}. ${pos.tokenName0}/${pos.tokenName1}** (${pos.protocol})\n`;
      output += `  • Position: ${pos.position.substring(0, 8)}...${pos.position.substring(pos.position.length - 6)}\n`;
      output += `  • Value: ${parseFloat(pos.currentValue).toFixed(2)} (${pos.current.amount0Adjusted.toFixed(4)} ${pos.tokenName0} + ${pos.current.amount1Adjusted.toFixed(4)} ${pos.tokenName1})\n`;
      output += `  • ${pnlSign} PnL: ${pnlColor}${pos.pnl.percent.toFixed(2)}% (${pnlColor}${pos.pnl.value.toFixed(3)})\n`;
      output += `  • Fees Collected: ${pos.collectedFee.toFixed(2)}\n`;
      output += `  • Fees Uncollected: ${uncollectedFee.toFixed(2)}${uncollectedFee > 0 ? ' 💰' : ''}\n`;
      output += `  • Age: ${pos.age} days\n`;
      output += `  • Status: ${pos.inRange ? '✅ In Range' : '⚠️ Out of Range'}\n\n`;
    });

    return output;
  }

  /**
   * Format overview/PnL statistics
   */
  formatOverview(data) {
    if (!data || !data.data) {
      return 'No overview data found.';
    }

    const d = data.data;
    const totalPnlSign = d.total_pnl.ALL >= 0 ? '📈' : '📉';
    const pnlColor = d.total_pnl.ALL >= 0 ? '+' : '';

    let output = `💼 **Wallet Overview**\n`;
    output += `📍 Owner: ${d.owner.substring(0, 8)}...${d.owner.substring(d.owner.length - 6)}\n`;
    output += `⛓️ Chain: ${d.chain} | Protocol: ${d.protocol}\n\n`;

    output += `**📊 Performance Summary**\n`;
    output += `${totalPnlSign} Total PnL: ${pnlColor}$${d.total_pnl.ALL.toFixed(2)}\n`;
    output += `💰 Total Fees: $${d.total_fee.ALL.toFixed(2)}\n`;
    output += `📥 Total Inflow: $${d.total_inflow.toFixed(2)}\n`;
    output += `📤 Total Outflow: $${d.total_outflow.toFixed(2)}\n\n`;

    output += `**📈 Statistics**\n`;
    output += `🎯 Win Rate: ${(d.win_rate.ALL * 100).toFixed(2)}% (${d.win_lp}/${d.closed_lp.ALL} positions)\n`;
    output += `💵 ROI: ${(d.roi * 100).toFixed(2)}%\n`;
    output += `📊 Total Positions: ${d.total_lp} (${d.opening_lp} open, ${d.closed_lp.ALL} closed)\n`;
    output += `🏊 Total Pools: ${d.total_pool}\n`;
    output += `⏱️ Avg Position Age: ${d.avg_age_hour.toFixed(2)} hours\n\n`;

    output += `**📅 Time Period Breakdown**\n`;
    output += `7D: ${pnlColor}$${d.total_pnl['7D'].toFixed(2)} | Fees: $${d.total_fee['7D'].toFixed(2)}\n`;
    output += `1M: ${pnlColor}$${d.total_pnl['1M'].toFixed(2)} | Fees: $${d.total_fee['1M'].toFixed(2)}\n`;
    output += `3M: ${pnlColor}$${d.total_pnl['3M'].toFixed(2)} | Fees: $${d.total_fee['3M'].toFixed(2)}\n\n`;

    output += `🕐 Last Updated: ${d.updated_at}`;

    return output;
  }

  /**
   * Format historical positions with pagination
   */
  formatHistoricalPositions(data) {
    if (!data || !data.data || !data.data.data || data.data.data.length === 0) {
      return 'No historical positions found.';
    }

    const positions = data.data.data;
    const pagination = data.data.pagination;

    let output = `📜 **Position History (Page ${pagination.currentPage}/${pagination.totalPages})**\n`;
    output += `Total: ${pagination.totalCount} positions\n\n`;

    positions.forEach((pos, idx) => {
      const pnlSign = pos.pnl.percent >= 0 ? '✅' : '❌';
      const pnlColor = pos.pnl.percent >= 0 ? '+' : '';
      
      output += `**${(pagination.currentPage - 1) * pagination.pageSize + idx + 1}. ${pos.tokenName0}/${pos.tokenName1}**\n`;
      output += `  • ${pnlSign} PnL: ${pnlColor}${pos.pnl.percent.toFixed(2)}% ($${pnlColor}${pos.pnl.value.toFixed(2)})\n`;
      output += `  • Fees: $${pos.collectedFee.toFixed(2)}\n`;
      output += `  • Opened: ${new Date(pos.createdAt).toLocaleDateString()}\n`;
      output += `  • Closed: ${new Date(pos.closeAt).toLocaleDateString()}\n`;
      output += `  • Duration: ${pos.age} days\n\n`;
    });

    return output;
  }
}
export default LPAgentClient;