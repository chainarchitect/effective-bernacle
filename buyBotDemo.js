require('dotenv').config();
const ethers = require('ethers');
const TelegramBot = require('node-telegram-bot-api');
const https = require('https');

// Config
const BOT_TOKEN = process.env.BOT_TOKEN;
const GROUP_ID = process.env.GROUP_ID;
const VIDEO_FILE_ID = process.env.VIDEO_FILE_ID;
const WS_RPC_URL = process.env.WS_RPC_URL;   // wss://mainnet.infura.io/ws/v3/YOUR_KEY
const RPC_URL = process.env.RPC_URL;           // https://mainnet.infura.io/v3/YOUR_KEY (fallback)
const PRESALE_CONTRACT = '0xC53fa85B734717CFd999343f6024165f0eC423b7';

// Initialize Telegram bot
const bot = new TelegramBot(BOT_TOKEN, {
    polling: {
        interval: 300,
        autoStart: true,
        params: { timeout: 10 }
    }
});

// Global state
let ETH_PRICE = 3800;
let wsProvider = null;
let httpProvider = null;
let contract = null;
let isWsConnected = false;
let reconnectAttempts = 0;

// Block tracking
let lastKnownBlock = 0;          // Last block seen (from WS or polling)
let wsDroppedAtBlock = 0;        // Block when WS disconnected

// Polling state — only runs when WS is down
let pollingInterval = null;
let pollingStartTimeout = null;
const POLL_INTERVAL = 60000;           // Poll every 60s (only when WS is down)
const POLL_ACTIVATION_DELAY = 120000;  // Wait 2 min before activating polling
const MAX_RECONNECT_DELAY = 60000;

const processedTxs = new Set();

// Presale Contract ABI
const ABI = [
    "event TokensPurchased(address indexed buyer, uint256 baseTokens, uint256 bonusTokens, uint256 usdAmount, address referrer, bool isETH)"
];

// ========================================
// ETH PRICE
// ========================================
async function fetchETHPrice() {
    return new Promise((resolve) => {
        https.get('https://api.coingecko.com/api/v3/simple/price?ids=ethereum&vs_currencies=usd', (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                try {
                    const price = JSON.parse(data).ethereum.usd;
                    console.log(`💰 ETH Price: $${price}`);
                    resolve(price);
                } catch (e) {
                    console.log(`⚠️ Using fallback ETH price: $${ETH_PRICE}`);
                    resolve(ETH_PRICE);
                }
            });
        }).on('error', () => {
            console.log(`⚠️ Using fallback ETH price: $${ETH_PRICE}`);
            resolve(ETH_PRICE);
        });
    });
}

// ========================================
// HELPERS
// ========================================
function formatNum(num) {
    return new Intl.NumberFormat('en-US', {
        minimumFractionDigits: 0,
        maximumFractionDigits: 0
    }).format(num);
}

function formatAddr(addr) {
    return `${addr.slice(0, 6)}...${addr.slice(-4)}`;
}

function getTier(mmvAmount) {
    if (mmvAmount >= 2500000) return { emoji: '🤑🤑🤑🤑🤑🤑🤑', label: 'WHALE' };
    if (mmvAmount >= 1000000) return { emoji: '🤑🤑🤑🤑🤑🤑', label: 'SHARK' };
    if (mmvAmount >= 500000) return { emoji: '🤑🤑🤑🤑🤑', label: 'DOLPHIN' };
    if (mmvAmount >= 100000) return { emoji: '🤑🤑🤑🤑', label: 'FISH' };
    if (mmvAmount >= 50000) return { emoji: '🤑🤑🤑', label: 'SHRIMP' };
    if (mmvAmount >= 10000) return { emoji: '🤑🤑', label: 'PLANKTON' };
    return { emoji: '🤑', label: 'DUST' };
}

function getHttpProvider() {
    if (!httpProvider) {
        httpProvider = new ethers.JsonRpcProvider(RPC_URL);
    }
    return httpProvider;
}

// ========================================
// PROCESS EVENT (shared by WS + polling)
// ========================================
async function processEvent(event) {
    const txHash = event.log?.transactionHash || event.transactionHash;

    if (processedTxs.has(txHash)) return;
    processedTxs.add(txHash);

    // Cap dedup set at 500
    if (processedTxs.size > 500) {
        const first = processedTxs.values().next().value;
        processedTxs.delete(first);
    }

    try {
        const [buyer, baseTokens, bonusTokens, usdAmount, referrer, isETH] = event.args || [];

        const baseMMV = parseFloat(ethers.formatUnits(baseTokens, 18));
        const bonusMMV = parseFloat(ethers.formatUnits(bonusTokens, 18));
        const totalMMV = baseMMV + bonusMMV;
        const usdValue = parseFloat(ethers.formatUnits(usdAmount, 18));

        let displayAmount;
        if (isETH) {
            const paidETH = usdValue / ETH_PRICE;
            displayAmount = `${paidETH.toFixed(4)} ETH`;
        } else {
            displayAmount = `${usdValue.toFixed(2)} USDT`;
        }

        const tier = getTier(totalMMV);
        const bonusPercent = baseMMV > 0 ? Math.round((bonusMMV / baseMMV) * 100) : 0;

        await sendAlert(tier, displayAmount, baseMMV, bonusMMV, totalMMV, bonusPercent, buyer, txHash);
        console.log('🔴 REAL TRANSACTION POSTED');
    } catch (error) {
        console.error('❌ Error processing tx:', error.message);
    }
}

// ========================================
// SEND TELEGRAM ALERT
// ========================================
async function sendAlert(tier, displayAmount, baseMMV, bonusMMV, totalMMV, bonusPercent, buyer, txHash) {
    try {
        const message = `
${tier.emoji} <b>${tier.label} ALERT!</b>

💎 ${displayAmount} = ${formatNum(baseMMV)} $MMV
🎁 +${bonusPercent}% Bonus = ${formatNum(bonusMMV)} $MMV
━━━━━━━━━━━━━━━
🚀 TOTAL: ${formatNum(totalMMV)} $MMV

👤 <code>${formatAddr(buyer)}</code>

⚡ Stage 1 won't last. Get 3X tokens NOW.
        `.trim();

        const keyboard = {
            inline_keyboard: [
                [
                    { text: '🚀 Buy $MMV', url: 'https://www.metamemevault.com/' },
                    { text: '🔒 Lock $MMV', url: 'https://www.metamemevault.com/memetreasury' }
                ]
            ]
        };

        await bot.sendVideo(GROUP_ID, VIDEO_FILE_ID, {
            caption: message,
            parse_mode: 'HTML',
            reply_markup: keyboard,
            supports_streaming: true
        });

        console.log(`✅ ${tier.label}: ${formatNum(totalMMV)} MMV by ${formatAddr(buyer)}`);
    } catch (error) {
        console.error('❌ Error sending alert:', error.message);
    }
}

// ========================================
// BATCH CATCH-UP (fills the gap after WS reconnects)
// ========================================
async function catchUpMissedBlocks() {
    if (wsDroppedAtBlock === 0 || lastKnownBlock === 0) return;

    const fromBlock = wsDroppedAtBlock;
    try {
        const provider = getHttpProvider();
        const currentBlock = await provider.getBlockNumber();
        const toBlock = currentBlock;

        if (toBlock <= fromBlock) return;

        console.log(`🔍 Catching up missed blocks: ${fromBlock} → ${toBlock} (${toBlock - fromBlock} blocks)`);

        const catchUpContract = new ethers.Contract(PRESALE_CONTRACT, ABI, provider);
        const events = await catchUpContract.queryFilter('TokensPurchased', fromBlock, toBlock);

        for (const event of events) {
            await processEvent(event);
        }

        lastKnownBlock = toBlock;
        console.log(`✅ Catch-up complete. ${events.length} event(s) found.`);
    } catch (error) {
        console.error('❌ Catch-up error:', error.message);
    }
}

// ========================================
// POLLING (only activates when WS is down for 2+ min)
// ========================================
function startPolling() {
    if (pollingInterval) return; // Already running

    console.log('📡 Polling activated (WS down for 2+ min)');

    pollingInterval = setInterval(async () => {
        // If WS came back, stop polling
        if (isWsConnected) {
            stopPolling();
            return;
        }

        try {
            const provider = getHttpProvider();
            const currentBlock = await provider.getBlockNumber();
            if (currentBlock <= lastKnownBlock) return;

            const pollContract = new ethers.Contract(PRESALE_CONTRACT, ABI, provider);
            const events = await pollContract.queryFilter('TokensPurchased', lastKnownBlock + 1, currentBlock);

            for (const event of events) {
                await processEvent(event);
            }

            lastKnownBlock = currentBlock;

            if (events.length > 0) {
                console.log(`📡 Polling caught ${events.length} event(s)`);
            }
        } catch (error) {
            console.error('❌ Polling error:', error.message);
        }
    }, POLL_INTERVAL);
}

function stopPolling() {
    if (pollingInterval) {
        clearInterval(pollingInterval);
        pollingInterval = null;
        console.log('⏸️ Polling paused (WS reconnected)');
    }
    if (pollingStartTimeout) {
        clearTimeout(pollingStartTimeout);
        pollingStartTimeout = null;
    }
}

// Schedule polling to start after delay (gives WS time to reconnect first)
function schedulePollingStart() {
    if (pollingInterval || pollingStartTimeout) return;

    console.log(`⏳ Polling will activate in ${POLL_ACTIVATION_DELAY / 1000}s if WS stays down...`);

    pollingStartTimeout = setTimeout(() => {
        pollingStartTimeout = null;
        if (!isWsConnected) {
            startPolling();
        }
    }, POLL_ACTIVATION_DELAY);
}

// ========================================
// WEBSOCKET CONNECTION + AUTO-RECONNECT
// ========================================
function connectWebSocket() {
    try {
        console.log(`🔌 Connecting WebSocket...`);
        wsProvider = new ethers.WebSocketProvider(WS_RPC_URL);
        contract = new ethers.Contract(PRESALE_CONTRACT, ABI, wsProvider);

        // Listen for real-time events
        contract.on('TokensPurchased', async (buyer, baseTokens, bonusTokens, usdAmount, referrer, isETH, event) => {
            // Track latest block from WS events
            const blockNum = event.log?.blockNumber || event.blockNumber;
            if (blockNum && blockNum > lastKnownBlock) {
                lastKnownBlock = blockNum;
            }
            await processEvent(event);
        });

        wsProvider.websocket.on('open', async () => {
            const wasDisconnected = !isWsConnected && wsDroppedAtBlock > 0;
            isWsConnected = true;
            reconnectAttempts = 0;
            console.log('✅ WebSocket connected');

            // Stop polling — WS is back
            stopPolling();

            // Catch up any blocks missed during the gap
            if (wasDisconnected) {
                await catchUpMissedBlocks();
            }

            wsDroppedAtBlock = 0;
        });

        wsProvider.websocket.on('close', async (code, reason) => {
            isWsConnected = false;

            // Record the block where WS dropped
            try {
                const provider = getHttpProvider();
                wsDroppedAtBlock = await provider.getBlockNumber();
            } catch (e) {
                wsDroppedAtBlock = lastKnownBlock;
            }

            console.log(`⚠️ WebSocket closed (code: ${code}) at block ~${wsDroppedAtBlock}. Reconnecting...`);

            // Schedule polling as safety net if WS stays down
            schedulePollingStart();
            scheduleReconnect();
        });

        wsProvider.websocket.on('error', (err) => {
            isWsConnected = false;
            console.error('❌ WebSocket error:', err.message);
        });

    } catch (error) {
        console.error('❌ WebSocket connection failed:', error.message);
        isWsConnected = false;
        schedulePollingStart();
        scheduleReconnect();
    }
}

function scheduleReconnect() {
    reconnectAttempts++;
    const delay = Math.min(2000 * Math.pow(2, reconnectAttempts - 1), MAX_RECONNECT_DELAY);
    console.log(`🔄 Reconnect attempt #${reconnectAttempts} in ${delay / 1000}s...`);

    setTimeout(() => {
        try {
            if (contract) contract.removeAllListeners();
            if (wsProvider) wsProvider.destroy();
        } catch (e) { /* ignore cleanup errors */ }

        connectWebSocket();
    }, delay);
}

// ========================================
// ERROR HANDLING
// ========================================
bot.on('polling_error', (error) => {
    console.error('❌ Telegram error:', error.message);
});

process.on('uncaughtException', (error) => {
    console.error('❌ Uncaught Exception:', error);
    setTimeout(() => process.exit(1), 1000);
});

process.on('unhandledRejection', (error) => {
    console.error('❌ Unhandled Rejection:', error);
});

// ========================================
// STARTUP
// ========================================
(async () => {
    console.log('🤖 MMV Buy Bot Starting...');

    // Fetch ETH price on startup + refresh every 5 min
    ETH_PRICE = await fetchETHPrice();
    setInterval(async () => {
        ETH_PRICE = await fetchETHPrice();
    }, 300000);

    // Get starting block (1 HTTP request at boot)
    try {
        const provider = getHttpProvider();
        lastKnownBlock = await provider.getBlockNumber();
        console.log(`📦 Starting from block ${lastKnownBlock}`);
    } catch (err) {
        console.error('❌ Could not get starting block:', err.message);
    }

    console.log(`📡 Monitoring: ${PRESALE_CONTRACT}`);
    console.log(`💬 Posting to: ${GROUP_ID}`);
    console.log(`🕐 ${new Date().toLocaleString()}`);
    console.log('━'.repeat(50));

    // Primary: WebSocket — polling stays OFF unless WS drops for 2+ min
    connectWebSocket();

    console.log('✅ Listening via WebSocket (polling on standby)');

    // Keep alive heartbeat
    setInterval(() => {
        const pollStatus = pollingInterval ? '🟡 POLLING' : '⚪ STANDBY';
        console.log(`💚 Bot alive | WS: ${isWsConnected ? '🟢' : '🔴'} | Fallback: ${pollStatus} | ${new Date().toLocaleTimeString()}`);
    }, 600000);
})();
