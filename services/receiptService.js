// services/receiptService.js
const Cooperative = require('../models/cooperative');
const Farmer = require('../models/farmer');
const Porter = require('../models/porter');
const Transaction = require('../models/transaction');
const { generateQRCode } = require('../utils/qrUtils');
const logger = require('../utils/logger');

class ReceiptPrinter {
    constructor() {
        this.lineWidth = 32; // Sunmi thermal printer standard (384px / 12px char)
    }

    // Format text for thermal printer
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

    // Generate SUNMI THERMAL RECEIPT (ESC/POS commands)
    async generateThermalReceipt(transactionId) {
        try {
            const transaction = await Transaction.findById(transactionId)
                .populate('farmer_id', 'name farmer_code')
                .populate('porter_id', 'name')
                .populate('cooperativeId', 'name contact')
                .lean();

            if (!transaction) {
                throw new Error('Transaction not found');
            }

            const cooperative = transaction.cooperativeId;
            const farmer = transaction.farmer_id;
            const porter = transaction.porter_id;

            // Generate QR with verification data
            const qrData = `REC:${transaction.receipt_num}|F:${farmer.farmer_code}|L:${transaction.litres}|P:${transaction.payout}`;
            const qrImage = await generateQRCode(qrData);

            // ✅ CLEAN RECEIPT - NO IDs, NO INTERNAL DATA
            const receiptLines = [
                '\x1b\x40', // Initialize printer
                '\x1b\x0a',  // Line feed
                this.formatLine('★ MILK DELIVERY ★', 'center'), // Title
                '\x1b\x0a',
                '\x1b\x0a',

                // Cooperative Header
                this.formatLine(cooperative.name.toUpperCase(), 'center'),
                this.formatLine('Milk Collection', 'center'),
                '\x1b\x0a',

                // Divider
                '='.repeat(this.lineWidth),
                '\x1b\x0a',

                // Transaction Details
                this.formatLine(`Receipt: ${transaction.receipt_num}`, 'left', this.lineWidth),
                this.formatLine(`Date: ${transaction.timestamp_server.toLocaleDateString()}`, 'left', this.lineWidth),
                '\x1b\x0a',

                // Farmer
                `Farmer: ${farmer.name}`,
                `Code: ${farmer.farmer_code}`,
                '\x1b\x0a',

                // Porter
                `Porter: ${porter ? porter.name : 'Direct'}`,
                '\x1b\x0a',

                // Milk Details
                '='.repeat(this.lineWidth),
                '\x1b\x0a',
                this.formatLine('MILK DELIVERY', 'center'),
                '\x1b\x0a',
                `Litres: ${transaction.litres.toFixed(1)} L`,
                `Rate: ${transaction.rate_version_id.rate}`, // Show rate for transparency
                `Payout: KES ${transaction.payout.toFixed(2)}`,
                '\x1b\x0a',
                '='.repeat(this.lineWidth),
                '\x1b\x0a',

                // QR Code (64mm width for Sunmi)
                '\x1d\x28\x6b\x04\x00\x31\x41\x32\x00', // QR Model 2, Level L
                '\x1d\x28\x6b\x03\x00\x31\x43\x08',     // QR Size 8
                Buffer.from(qrData, 'utf8'),            // QR Data
                '\x1d\x28\x6b\x03\x00\x31\x45\x00',     // Print QR

                '\x1b\x0a',
                '\x1b\x0a',

                // Footer
                this.formatLine('Thank you for your milk!', 'center'),
                this.formatLine('Keep this receipt safe', 'center'),
                '\x1b\x0a',
                this.formatLine('Verify at coop.com/verify', 'center'),
                '\x1b\x0a\x1b\x0a',

                // Cut paper
                '\x1d\x56\x00' // Cut
            ];

            logger.info('✅ Thermal receipt generated', {
                receiptNum: transaction.receipt_num,
                farmer: farmer.name,
                litres: transaction.litres,
                payout: transaction.payout
            });

            return {
                thermalReceipt: Buffer.concat(receiptLines.map(line => Buffer.isBuffer(line) ? line : Buffer.from(line))),
                qrImage, // For screen display if needed
                receiptNum: transaction.receipt_num,
                previewText: receiptLines.map(l => typeof l === 'string' ? l.trim() : '[QR]').join('\n')
            };

        } catch (error) {
            logger.error('Receipt generation failed', { transactionId, error: error.message });
            throw error;
        }
    }

    // Simple TEXT receipt for debugging
    generateTextReceipt(transactionId) {
        return this.generateThermalReceipt(transactionId).then(result => result.previewText);
    }
}

module.exports = new ReceiptPrinter();