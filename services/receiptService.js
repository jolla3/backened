const Cooperative = require('../models/cooperative');
const Farmer = require('../models/farmer');
const Porter = require('../models/porter');
const Transaction = require('../models/transaction');
const { generateQRCode } = require('../utils/qrUtils');
const logger = require('../utils/logger');

class ReceiptPrinter {
    constructor() {
        this.lineWidth = 32; // Sunmi thermal printer standard
    }

    formatLine(text, align = 'left', maxWidth = 32) {
        const pad = ' '.repeat(maxWidth);
        if (align === 'center') {
            const spaces = Math.floor((maxWidth - text.length) / 2);
            return ' '.repeat(spaces) + text;
        }
        if (align === 'right') {
            return pad.substring(0, maxWidth - text.length) + text;
        }
        return text + pad.substring(0, maxWidth - text.length);
    }

    // ✅ Accept session, handle missing references safely
    async generateThermalReceipt(transactionId, session = null) {
        try {
            let query = Transaction.findById(transactionId)
                .populate('farmer_id', 'name farmer_code')
                .populate('porter_id', 'name')
                .populate('cooperativeId', 'name contact')
                .populate('rate_version_id', 'rate');

            if (session) {
                query = query.session(session);
            }

            const transaction = await query.lean();

            if (!transaction) {
                throw new Error('Transaction not found');
            }

            // ✅ Safe extraction with fallbacks
            const cooperative = transaction.cooperativeId || { name: 'Cooperative' };
            const farmer = transaction.farmer_id || { name: 'Unknown', farmer_code: 'N/A' };
            const porter = transaction.porter_id || { name: 'Direct' };
            const rate = transaction.rate_version_id?.rate || 0;

            // Generate QR data (use fallback if farmer_code missing)
            const qrData = `REC:${transaction.receipt_num}|F:${farmer.farmer_code}|L:${transaction.litres}|P:${transaction.payout}`;
            const qrImage = await generateQRCode(qrData);

            const receiptLines = [
                '\x1b\x40',
                '\x1b\x0a',
                this.formatLine('★ MILK DELIVERY ★', 'center'),
                '\x1b\x0a',
                '\x1b\x0a',
                this.formatLine(cooperative.name.toUpperCase(), 'center'),
                this.formatLine('Milk Collection', 'center'),
                '\x1b\x0a',
                '='.repeat(this.lineWidth),
                '\x1b\x0a',
                this.formatLine(`Receipt: ${transaction.receipt_num}`, 'left', this.lineWidth),
                this.formatLine(`Date: ${transaction.timestamp_server.toLocaleDateString()}`, 'left', this.lineWidth),
                '\x1b\x0a',
                `Farmer: ${farmer.name}`,
                `Code: ${farmer.farmer_code}`,
                '\x1b\x0a',
                `Porter: ${porter.name}`,
                '\x1b\x0a',
                '='.repeat(this.lineWidth),
                '\x1b\x0a',
                this.formatLine('MILK DELIVERY', 'center'),
                '\x1b\x0a',
                `Litres: ${transaction.litres.toFixed(1)} L`,
                `Rate: ${rate}`,
                `Payout: KES ${transaction.payout.toFixed(2)}`,
                '\x1b\x0a',
                '='.repeat(this.lineWidth),
                '\x1b\x0a',
                '\x1d\x28\x6b\x04\x00\x31\x41\x32\x00',
                '\x1d\x28\x6b\x03\x00\x31\x43\x08',
                Buffer.from(qrData, 'utf8'),
                '\x1d\x28\x6b\x03\x00\x31\x45\x00',
                '\x1b\x0a',
                '\x1b\x0a',
                this.formatLine('Thank you for your milk!', 'center'),
                this.formatLine('Keep this receipt safe', 'center'),
                '\x1b\x0a',
                this.formatLine('Verify at coop.com/verify', 'center'),
                '\x1b\x0a\x1b\x0a',
                '\x1d\x56\x00'
            ];

            logger.info('✅ Thermal receipt generated', {
                receiptNum: transaction.receipt_num,
                farmer: farmer.name,
                litres: transaction.litres,
                payout: transaction.payout
            });

            return {
                thermalReceipt: Buffer.concat(receiptLines.map(line => Buffer.isBuffer(line) ? line : Buffer.from(line))),
                qrImage,
                receiptNum: transaction.receipt_num,
                previewText: receiptLines.map(l => typeof l === 'string' ? l.trim() : '[QR]').join('\n')
            };

        } catch (error) {
            logger.error('Receipt generation failed', { transactionId, error: error.message });
            throw error;
        }
    }

    generateTextReceipt(transactionId) {
        return this.generateThermalReceipt(transactionId).then(result => result.previewText);
    }
}

module.exports = new ReceiptPrinter();