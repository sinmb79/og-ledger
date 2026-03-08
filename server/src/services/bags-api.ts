import axios, { AxiosInstance } from "axios";

// ─── Trade ───────────────────────────────────────────────────────

export interface BagsQuoteRequest {
  inputMint: string;
  outputMint: string;
  amount: string;
  swapMode?: string;
  slippageBps?: number;
  platformFeeBps?: number;
}

export interface BagsQuoteResponse {
  raw: unknown;
}

export interface BagsCreateSwapRequest {
  wallet: string;
  quoteResponse: unknown;
  wrapAndUnwrapSol?: boolean;
}

export interface BagsCreateSwapResponse {
  transaction?: string;
  raw: unknown;
}

// ─── Token Launch ────────────────────────────────────────────────

export interface BagsCreateTokenInfoRequest {
  name: string;
  symbol: string;
  description?: string;
  image?: string;
  twitter?: string;
  telegram?: string;
  website?: string;
}

export interface BagsCreateTokenInfoResponse {
  metadataUri?: string;
  raw: unknown;
}

export interface BagsCreateLaunchTxRequest {
  creator: string;
  tokenInfo: BagsCreateTokenInfoRequest;
  initialBuyAmount?: string;
  feeShareConfigId?: string;
}

export interface BagsCreateLaunchTxResponse {
  transaction?: string;
  mint?: string;
  raw: unknown;
}

// ─── Fee Share ───────────────────────────────────────────────────

export interface BagsCreateFeeShareConfigRequest {
  name: string;
  shares: Array<{ wallet: string; bps: number }>;
}

export interface BagsCreateFeeShareConfigResponse {
  id?: string;
  name?: string;
  raw: unknown;
}

export interface BagsPartnerConfigCreationTxRequest {
  partnerName: string;
  partnerWallet: string;
  feeBps: number;
}

export interface BagsPartnerConfigCreationTxResponse {
  transaction?: string;
  raw: unknown;
}

export interface BagsPartnerStatsRequest {
  partner: string; // wallet pubkey
}

export interface BagsPartnerStatsResponse {
  raw: unknown;
}

// ─── Claimable / Claim ───────────────────────────────────────────

export interface BagsClaimablePositionsRequest {
  wallet: string;
  page?: number;
  pageSize?: number;
}

export interface BagsClaimablePositionsResponse {
  raw: unknown;
}

export interface BagsClaimTxV3Request {
  wallet: string;
  mint: string;
  amount?: string;
}

export interface BagsClaimTxV3Response {
  transaction?: string;
  raw: unknown;
}

// ─── Analytics ───────────────────────────────────────────────────

export interface BagsTokenLifetimeFeesResponse {
  raw: unknown;
}

export interface BagsTokenClaimStatsResponse {
  raw: unknown;
}

export interface BagsTokenClaimEventsRequest {
  tokenMint: string;
  mode?: string;
  limit?: number;
  offset?: number;
  from?: string;
  to?: string;
}

export interface BagsTokenClaimEventsResponse {
  raw: unknown;
}

export interface BagsTokenCreatorV3Response {
  raw: unknown;
}

// ─── State / Pools ───────────────────────────────────────────────

export interface BagsPoolsRequest {
  onlyMigrated?: boolean;
}

export interface BagsPoolsResponse {
  raw: unknown;
}

export interface BagsPoolByMintResponse {
  raw: unknown;
}

// ─── Solana Transaction ──────────────────────────────────────────

export interface BagsSendTransactionRequest {
  tx: string;
  skipPreflight?: boolean;
  maxRetries?: number;
}

export interface BagsSendTransactionResponse {
  signature?: string;
  raw: unknown;
}

// ─── Client ──────────────────────────────────────────────────────

export class BagsApiClient {
  private readonly http: AxiosInstance;

  constructor(apiKey: string, baseURL = "https://public-api-v2.bags.fm/api/v1") {
    this.http = axios.create({
      baseURL,
      headers: {
        "x-api-key": apiKey,
        "Content-Type": "application/json"
      },
      timeout: 30000
    });
  }

  // ── Trade ────────────────────────────────────────────────────

  async getQuote(payload: BagsQuoteRequest): Promise<BagsQuoteResponse> {
    const { data } = await this.http.get("/trade/quote", { params: payload });
    return { raw: data };
  }

  async createSwap(payload: BagsCreateSwapRequest): Promise<BagsCreateSwapResponse> {
    const { data } = await this.http.post("/trade/swap", payload);
    return { transaction: data.transaction ?? data.swapTransaction, raw: data };
  }

  // ── Token Launch ─────────────────────────────────────────────

  async createTokenInfo(payload: BagsCreateTokenInfoRequest): Promise<BagsCreateTokenInfoResponse> {
    const { data } = await this.http.post("/token-launch/create-token-info", payload);
    return { metadataUri: data.metadataUri, raw: data };
  }

  async createLaunchTx(payload: BagsCreateLaunchTxRequest): Promise<BagsCreateLaunchTxResponse> {
    const { data } = await this.http.post("/token-launch/create-launch-transaction", payload);
    return { transaction: data.transaction, mint: data.mint, raw: data };
  }

  // ── Fee Share ────────────────────────────────────────────────

  async createFeeShareConfig(payload: BagsCreateFeeShareConfigRequest): Promise<BagsCreateFeeShareConfigResponse> {
    const { data } = await this.http.post("/fee-share/config", payload);
    return { id: data.id, name: data.name, raw: data };
  }

  async createPartnerConfigTx(payload: BagsPartnerConfigCreationTxRequest): Promise<BagsPartnerConfigCreationTxResponse> {
    const { data } = await this.http.post("/fee-share/partner-config/creation-tx", payload);
    return { transaction: data.transaction, raw: data };
  }

  async getPartnerStats(payload: BagsPartnerStatsRequest): Promise<BagsPartnerStatsResponse> {
    const { data } = await this.http.get("/fee-share/partner-config/stats", { params: payload });
    return { raw: data };
  }

  // ── Claimable / Claim ────────────────────────────────────────

  async getClaimablePositions(payload: BagsClaimablePositionsRequest): Promise<BagsClaimablePositionsResponse> {
    const { data } = await this.http.get("/token-launch/claimable-positions", { params: payload });
    return { raw: data };
  }

  async getClaimTxV3(payload: BagsClaimTxV3Request): Promise<BagsClaimTxV3Response> {
    const { data } = await this.http.post("/token-launch/claim-txs/v3", payload);
    return { transaction: data.transaction, raw: data };
  }

  // ── Analytics ────────────────────────────────────────────────

  async getTokenLifetimeFees(tokenMint: string): Promise<BagsTokenLifetimeFeesResponse> {
    const { data } = await this.http.get("/token-launch/lifetime-fees", { params: { tokenMint } });
    return { raw: data };
  }

  async getTokenClaimStats(tokenMint: string): Promise<BagsTokenClaimStatsResponse> {
    const { data } = await this.http.get("/token-launch/claim-stats", { params: { tokenMint } });
    return { raw: data };
  }

  async getTokenClaimEvents(payload: BagsTokenClaimEventsRequest): Promise<BagsTokenClaimEventsResponse> {
    const { data } = await this.http.get("/fee-share/token/claim-events", { params: payload });
    return { raw: data };
  }

  async getTokenCreatorV3(tokenMint: string): Promise<BagsTokenCreatorV3Response> {
    const { data } = await this.http.get("/token-launch/creator/v3", { params: { tokenMint } });
    return { raw: data };
  }

  // ── State / Pools ────────────────────────────────────────────

  async getBagsPools(payload: BagsPoolsRequest = {}): Promise<BagsPoolsResponse> {
    const { data } = await this.http.get("/solana/bags/pools", { params: payload });
    return { raw: data };
  }

  async getBagsPoolByMint(tokenMint: string): Promise<BagsPoolByMintResponse> {
    const { data } = await this.http.get("/solana/bags/pools/token-mint", { params: { tokenMint } });
    return { raw: data };
  }

  // ── Solana Transaction ───────────────────────────────────────

  async sendTransaction(payload: BagsSendTransactionRequest): Promise<BagsSendTransactionResponse> {
    const { data } = await this.http.post("/solana/send-transaction", payload);
    return { signature: data.signature, raw: data };
  }

  // ── Health Check ─────────────────────────────────────────────

  async ping(): Promise<unknown> {
    const { data } = await this.http.get("/ping");
    return data;
  }
}
