import path from "path";
import dotenv from "dotenv";

dotenv.config({ path: path.resolve(__dirname, "../../.env") });

export interface AppConfig {
  port: number;
  bagsApiBaseUrl: string;
  bagsApiKey: string;
  botToken: string;
  channelId: string;
  groupId: string;
  bagsWallet: string;
  solanaRpc: string;
  adminTelegramId: string;
  apiSecret: string;
}

export const config: AppConfig = {
  port: Number(process.env.PORT ?? 3001),
  bagsApiBaseUrl: process.env.BAGS_API_BASE_URL ?? "https://public-api-v2.bags.fm/api/v1",
  bagsApiKey: process.env.BAGS_APIKEY ?? "",
  botToken: process.env.BOT_TOKEN ?? "",
  channelId: process.env.CHANNEL_ID ?? "",
  groupId: process.env.GROUP_ID ?? "",
  bagsWallet: process.env.BAGS_WALLET ?? "",
  solanaRpc: process.env.SOLANA_RPC ?? "",
  adminTelegramId: process.env.ADMIN_TG_ID ?? "",
  apiSecret: process.env.API_SECRET ?? ""
};
