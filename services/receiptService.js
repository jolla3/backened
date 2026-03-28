// services/receiptService.js
const Cooperative = require('../models/cooperative');
const Farmer = require('../models/farmer');
const Porter = require('../models/porter');
const Transaction = require('../models/transaction');
const { generateQRCode } = require('../utils/qrUtils');
const logger = require('../utils/logger');

class ReceiptPrinter {
    constructor() {
        this.lineWidth = 32;
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

    // Accept either transaction object or transactionId
    async generateThermalReceipt(transactionOrId) {
        try {
            let transaction;
            if (typeof transactionOrId === 'string') {
                // Fetch from DB if ID provided
                transaction = await Transaction.findById(transactionOrId)
                    .populate('farmer_id', 'name farmer_code')
                    .populate('porter_id', 'name')
                    .populate('cooperativeId', 'name contact')
                    .lean();
                if (!transaction) {
                    throw new Error('Transaction not found');
                }
            } else {
                // Assume it's already a populated transaction object
                transaction = transactionOrId;
                // If not populated, we need to fetch required fields? But we can assume it's populated.
            }

            const cooperative = transaction.cooperativeId;
            const farmer = transaction.farmer_id;
            const porter = transaction.porter_id;

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
                `Porter: ${porter ? porter.name : 'Direct'}`,
                '\x1b\x0a',
                '='.repeat(this.lineWidth),
                '\x1b\x0a',
                this.formatLine('MILK DELIVERY', 'center'),
                '\x1b\x0a',
                `Litres: ${transaction.litres.toFixed(1)} L`,
                `Rate: ${transaction.rate_version_id?.rate || 'N/A'}`,
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
            logger.error('Receipt generation failed', { error: error.message });
            throw error;
        }
    }

    generateTextReceipt(transactionId) {
        return this.generateThermalReceipt(transactionId).then(result => result.previewText);
    }
}

module.exports = new ReceiptPrinter();