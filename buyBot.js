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
const bot = new TelegramBot(BOT_TOKEN, { polling: true });
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
    "event TokensPurchased(address indexed buyer, uint256 amount, uint256 ethAmount, string paymentMethod, address indexed referrer)"
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

// Get tier (Whale = $20k+ = 2.5M MMV)
function getTier(mmvAmount) {
    if (mmvAmount >= 2500000) return { emoji: '🤑🤑🤑🤑🤑🤑🤑', label: 'WHALE' };
    if (mmvAmount >= 1000000) return { emoji: '🤑🤑🤑🤑🤑🤑', label: 'SHARK' };
    if (mmvAmount >= 500000) return { emoji: '🤑🤑🤑🤑🤑', label: 'DOLPHIN' };
    if (mmvAmount >= 100000) return { emoji: '🤑🤑🤑🤑', label: 'FISH' };
    if (mmvAmount >= 50000) return { emoji: '🤑🤑🤑', label: 'SHRIMP' };
    if (mmvAmount >= 10000) return { emoji: '🤑🤑', label: 'PLANKTON' };
    return { emoji: '🤑', label: 'DUST' };
}

// Listen for purchases
contract.on('TokensPurchased', async (buyer, amount, ethAmount, paymentMethod, referrer, event) => {
    try {
        const mmvAmount = parseFloat(ethers.formatUnits(amount, 18));
        const paidAmount = parseFloat(ethers.formatUnits(
            ethAmount, 
            paymentMethod === 'ETH' ? 18 : 6
        ));

        const tier = getTier(mmvAmount);
        const bonus = mmvAmount * 2; // 200% bonus Stage 1
        const total = mmvAmount + bonus;

        // Use fetched ETH price for display
        const displayAmount = paymentMethod === 'ETH'
            ? `${paidAmount.toFixed(4)} ETH`
            : `${paidAmount.toFixed(2)} ${paymentMethod}`;

        // Create message
        const message = `
${tier.emoji} <b>${tier.label} ALERT!</b>

💰 <b>${displayAmount}</b> → <b>${formatNum(total)} $MMV</b>
🎁 Bonus: +${formatNum(bonus)} MMV (200%)

👤 <code>${formatAddr(buyer)}</code>
🔗 <a href="https://etherscan.io/tx/${event.log.transactionHash}">Etherscan</a>

⚡ Stage 1 won't last. Get 3X tokens NOW.
        `.trim();

        // Buttons
        const keyboard = {
            inline_keyboard: [
                [
                    { text: '🚀 Buy $MMV', url: 'https://www.metamemevault.com/' },
                    { text: '🔒 Lock $MMV', url: 'https://www.metamemevault.com/memetreasury' }
                ]
            ]
        };

        // Send as animation
        await bot.sendAnimation(GROUP_ID, VIDEO_FILE_ID, {
            caption: message,
            parse_mode: 'HTML',
            reply_markup: keyboard
        });

        console.log(`✅ ${tier.label}: ${formatNum(total)} MMV by ${formatAddr(buyer)}`);
    } catch (error) {
        console.error('❌ Error sending alert:', error.message);
    }
});

// Provider error handling
provider.on('error', (error) => {
    console.error('❌ Provider error:', error.message);
});

// Telegram error handling
bot.on('polling_error', (error) => {
    console.error('❌ Telegram error:', error.message);
});

// Startup
(async () => {
    console.log('🤖 MMV Buy Bot Starting...');
    
    // Fetch ETH price once
    ETH_PRICE = await fetchETHPrice();
    
    console.log(`📡 Monitoring: ${PRESALE_CONTRACT}`);
    console.log(`💬 Posting to: ${GROUP_ID}`);
    console.log(`⏰ ${new Date().toLocaleString()}`);
    console.log('━'.repeat(50));
    
    // Keep alive
    setInterval(() => {
        console.log(`💚 Bot alive - ${new Date().toLocaleTimeString()}`);
    }, 300000); // Every 5 minutes
})();