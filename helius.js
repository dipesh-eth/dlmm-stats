import dotenv from 'dotenv';
dotenv.config();

const fetch = (...args) => import('node-fetch').then(({ default: fetch }) => fetch(...args)); // Debug line
const HELIUS_RPC_URL = `https://mainnet.helius-rpc.com/?api-key=${process.env.HELIUS_API_KEY}`;

async function getPositionIdFromTx(signature) {
  if (!process.env.HELIUS_API_KEY) {
    console.error('❌ Missing HELIUS_API_KEY environment variable!');
    return null;
  }

  const body = {
    method: "getTransaction",
    jsonrpc: "2.0",
    params: [signature, { encoding: "jsonParsed", commitment: "confirmed", maxSupportedTransactionVersion: 0 }],
    id: "1"
  };

  try {
    const response = await fetch(HELIUS_RPC_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify(body)
    });

    const json = await response.json();

    if (!json.result) {
      console.error("Helius RPC Error: No result in response.", json);
      return null;
    }

    const instructions = json.result.transaction.message.instructions;
    
    // The user's logic specified that the target is in the 6th instruction (index 5)
    if (!instructions || instructions.length <= 5) {
      console.error("Transaction does not have enough instructions.");
      return null;
    }

    const targetInstruction = instructions[5];
    if (!targetInstruction.accounts || targetInstruction.accounts.length === 0) {
      console.error("No accounts found in the target instruction.");
      return null;
    }

    // The first account in this specific instruction is the position ID
    const positionId = targetInstruction.accounts[0];
    console.log(`✅ Found Position ID: ${positionId} from Tx: ${signature}`);
    return positionId;

  } catch (error) {
    console.error("Error fetching transaction from Helius:", error);
    return null;
  }
}

export { getPositionIdFromTx };
