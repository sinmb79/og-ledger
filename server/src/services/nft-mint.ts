import { createUmi } from "@metaplex-foundation/umi-bundle-defaults";
import { create, mplCore } from "@metaplex-foundation/mpl-core";
import {
  createNoopSigner,
  generateSigner,
  publicKey,
  signerIdentity,
} from "@metaplex-foundation/umi";

export interface PrepareNftMintRequest {
  creator: string;
  name: string;
  symbol: string;
  uri: string;
  sellerFeeBasisPoints?: number;
}

export interface PrepareNftMintResult {
  transaction: string;
  mint: string;
  metadataPda: string;
  masterEditionPda: string;
}

export class NftMintService {
  constructor(private readonly rpcUrl: string) {}

  async prepareMintTx(input: PrepareNftMintRequest): Promise<PrepareNftMintResult> {
    const umi = createUmi(this.rpcUrl).use(mplCore());
    const creator = publicKey(input.creator);
    const creatorNoop = createNoopSigner(creator);
    umi.use(signerIdentity(creatorNoop, true));

    const asset = generateSigner(umi);
    const latest = await umi.rpc.getLatestBlockhash();

    const tx = await create(umi, {
      asset,
      owner: creator,
      name: input.name,
      uri: input.uri,
    })
      .setBlockhash(latest)
      .buildAndSign(umi);

    const serialized = umi.transactions.serialize(tx);
    const assetAddress = asset.publicKey;

    return {
      transaction: Buffer.from(serialized).toString("base64"),
      mint: assetAddress,
      metadataPda: "metaplex-core",
      masterEditionPda: "metaplex-core",
    };
  }
}
