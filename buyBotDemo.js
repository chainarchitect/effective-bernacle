require('dotenv').config();
const ethers = require('ethers');
const TelegramBot = require('node-telegram-bot-api');
const https = require('https');

// Config
const BOT_TOKEN = process.env.BOT_TOKEN;
const GROUP_ID = process.env.GROUP_ID;
const VIDEO_FILE_ID = process.env.VIDEO_FILE_ID;
const RPC_URL = process.env.RPC_URL;
const PRESALE_CONTRACT = '0xC53fa85B734717CFd999343f6024165f0eC423b7';

// Initialize
const bot = new TelegramBot(BOT_TOKEN, { 
    polling: {
        interval: 300,
        autoStart: true,
        params: { timeout: 10 }
    }
});
const provider = new ethers.JsonRpcProvider(RPC_URL);

// Global ETH price
let ETH_PRICE = 2500; // Fallback

// Fetch ETH price from CoinGecko
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

// Presale Contract ABI
const ABI = [
    "event TokensPurchased(address indexed buyer, uint256 baseTokens, uint256 bonusTokens, uint256 usdAmount, address referrer, bool isETH)"
];

const contract = new ethers.Contract(PRESALE_CONTRACT, ABI, provider);

// Format numbers
function formatNum(num) {
    return new Intl.NumberFormat('en-US', {
        minimumFractionDigits: 0,
        maximumFractionDigits: 0
    }).format(num);
}

// Format address
function formatAddr(addr) {
    return `${addr.slice(0, 6)}...${addr.slice(-4)}`;
}

// Generate random address (for demo)
function randomAddr() {
    const chars = '0123456789abcdef';
    let addr = '0x';
    for (let i = 0; i < 40; i++) {
        addr += chars[Math.floor(Math.random() * chars.length)];
    }
    return addr;
}

// Get tier
function getTier(mmvAmount) {
    if (mmvAmount >= 2500000) return { emoji: '🤑🤑🤑🤑🤑🤑🤑', label: 'WHALE' };
    if (mmvAmount >= 1000000) return { emoji: '🤑🤑🤑🤑🤑🤑', label: 'SHARK' };
    if (mmvAmount >= 500000) return { emoji: '🤑🤑🤑🤑🤑', label: 'DOLPHIN' };
    if (mmvAmount >= 100000) return { emoji: '🤑🤑🤑🤑', label: 'FISH' };
    if (mmvAmount >= 50000) return { emoji: '🤑🤑🤑', label: 'SHRIMP' };
    if (mmvAmount >= 10000) return { emoji: '🤑🤑', label: 'PLANKTON' };
    return { emoji: '🤑', label: 'DUST' };
}

// Send alert to Telegram
// ${txHash ? `🔗 <a href="https://etherscan.io/tx/${txHash}">Etherscan</a>\n` : ''}
async function sendAlert(tier, displayAmount, baseMMV, bonusMMV, totalMMV, bonusPercent, buyer, txHash) {
    try {
        const message = `
${tier.emoji} <b>${tier.label} ALERT!</b>

${txHash ? `💎` : '💰'} ${displayAmount} = ${formatNum(baseMMV)} $MMV
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
// REAL TRANSACTION LISTENER
// ========================================
contract.on('TokensPurchased', async (buyer, baseTokens, bonusTokens, usdAmount, referrer, isETH, event) => {
    try {
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

        await sendAlert(tier, displayAmount, baseMMV, bonusMMV, totalMMV, bonusPercent, buyer, event.log.transactionHash);
        
        console.log('🔴 REAL TRANSACTION POSTED');
    } catch (error) {
        console.error('❌ Error processing real tx:', error.message);
    }
});

// ========================================
// DEMO TRANSACTION GENERATOR
// ========================================
async function simulatePurchase() {
    try {
        // Random MMV amount: 2,500 - 100,000
        const baseMMV = Math.floor(Math.random() * 97500) + 2500;
        const bonusMMV = baseMMV * 2; // 200% bonus
        const totalMMV = baseMMV + bonusMMV;

        // Calculate USD (MMV price = $0.008)
        const usdAmount = baseMMV * 0.008;

        // Random payment method
        const methods = ['ETH', 'USDT', 'USDT'];
        const method = methods[Math.floor(Math.random() * methods.length)];

        const paidAmount = method === 'ETH'
            ? (usdAmount / ETH_PRICE).toFixed(4)
            : usdAmount.toFixed(2);

        const displayAmount = `${paidAmount} ${method}`;
        const tier = getTier(totalMMV);
        const buyer = randomAddr();
        const bonusPercent = 200;

        await sendAlert(tier, displayAmount, baseMMV, bonusMMV, totalMMV, bonusPercent, buyer, null);
        
        console.log('🟢 DEMO TRANSACTION POSTED');
    } catch (error) {
        console.error('❌ Error in demo tx:', error.message);
    }
}

// Schedule demo purchases: 2-3 times per hour (20-30 min intervals)
function scheduleNextDemo() {
    const delay = Math.floor(Math.random() * 600000) + 1200000; // 20-30 min
    
    setTimeout(async () => {
        await simulatePurchase();
        scheduleNextDemo();
    }, delay);
}

// ========================================
// ERROR HANDLING
// ========================================
provider.on('error', (error) => {
    console.error('❌ Provider error:', error.message);
});

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
    console.log('🤖 MMV Buy Bot Starting (Real + Demo)...');
    
    // Fetch ETH price
    ETH_PRICE = await fetchETHPrice();
    
    console.log(`📡 Monitoring: ${PRESALE_CONTRACT}`);
    console.log(`💬 Posting to: ${GROUP_ID}`);
    console.log(`🕐 ${new Date().toLocaleString()}`);
    console.log(`🎯 Demo: 2-3 purchases per hour`);
    console.log('━'.repeat(50));
    console.log('✅ Listening for REAL purchases...');
    console.log('✅ Demo purchases scheduled...');
    
    // Start demo simulation
    scheduleNextDemo();
    
    // Keep alive
    setInterval(() => {
        console.log(`💚 Bot alive - ${new Date().toLocaleTimeString()}`);
    }, 300000); // Every 5 minutes
})();




