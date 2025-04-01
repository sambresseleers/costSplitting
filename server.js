const express = require('express');
const methodOverride = require('method-override');
const crypto = require('crypto'); // For generating unique IDs
const path = require('path');
const fs = require('fs').promises; // Using promises for cleaner async operations

const app = express();
const port = 3002;
const dataFilePath = path.join(__dirname, 'data.json');

// --- Helper Functions ---
const formatCurrency = (amount) => {
    return new Intl.NumberFormat('nl-BE', { style: 'currency', currency: 'EUR' }).format(amount);
};
const PREFILLED_NAMES = ['Martyna', 'Joint', 'Mama'];

// --- Middleware ---
app.set('view engine', 'ejs'); // Set EJS as the templating engine
app.set('views', path.join(__dirname, 'views')); // Specify views directory
app.use(express.urlencoded({ extended: true })); // Parse URL-encoded bodies (form data)
app.use(methodOverride('_method')); // Allow PUT/DELETE via query param ?_method=...
app.use(express.static(path.join(__dirname, 'public'))); // Serve static files (like CSS)

// --- Data Persistence Functions ---
async function readExpenses() {
    try {
        const data = await fs.readFile(dataFilePath, 'utf8');
        return JSON.parse(data);
    } catch (error) {
        if (error.code === 'ENOENT') {
            // File not found, return an empty array
            return [];
        }
        console.error('Error reading expenses:', error);
        throw error;
    }
}

async function writeExpenses(expenses) {
    try {
        const jsonData = JSON.stringify(expenses, null, 4); // Use null, 4 for pretty printing
        await fs.writeFile(dataFilePath, jsonData, 'utf8');
    } catch (error) {
        console.error('Error writing expenses:', error);
        throw error;
    }
}

// --- Routes ---

// GET / - Input Form Page
app.get('/', (req, res) => {
    const prefillPerson = req.query.person || ''; // Get person name from query param
    res.render('index', { prefillPerson, names: PREFILLED_NAMES });
});

// POST /expenses - Add New Expense
app.post('/expenses', async (req, res) => {
    const { person, item, cost } = req.body;

    // Basic Validation
    if (!person || !item || !cost || isNaN(parseFloat(cost))) {
        console.error("Validation failed:", req.body);
        return res.redirect('/?error=Invalid input');
    }

    const newExpense = {
        id: crypto.randomUUID(),
        person: person.trim(),
        item: item.trim(),
        cost: parseFloat(cost),
        status: 'unpaid',
        addedTimestamp: Date.now(),
        paidTimestamp: null,
        paidBatchId: null,
    };

    try {
        const expenses = await readExpenses();
        expenses.push(newExpense);
        await writeExpenses(expenses);

        if (PREFILLED_NAMES.includes(newExpense.person)) {
            res.redirect(`/?person=${encodeURIComponent(newExpense.person)}`);
        } else {
            res.redirect('/');
        }
    } catch (error) {
        res.status(500).send('Error saving expense data.');
    }
});

// GET /report - Report Page (Unpaid Expenses)
app.get('/report', async (req, res) => {
    try {
        const expenses = await readExpenses();
        const unpaidExpenses = expenses.filter(e => e.status === 'unpaid');
        const reportData = {};

        unpaidExpenses.forEach(expense => {
            if (!reportData[expense.person]) {
                reportData[expense.person] = { items: [], total: 0 };
            }
            reportData[expense.person].items.push(expense);
            reportData[expense.person].total += expense.cost;
        });

        Object.values(reportData).forEach(personData => {
            personData.items.sort((a, b) => a.addedTimestamp - b.addedTimestamp);
            personData.totalFormatted = formatCurrency(personData.total);
        });

        unpaidExpenses.forEach(expense => {
            expense.costFormatted = formatCurrency(expense.cost);
        });

        res.render('report', { reportData });
    } catch (error) {
        res.status(500).send('Error reading expense data for report.');
    }
});

// GET /expenses/:id/edit - Show Edit Form
app.get('/expenses/:id/edit', async (req, res) => {
    try {
        const expenses = await readExpenses();
        const expense = expenses.find(e => e.id === req.params.id);
        if (!expense) {
            return res.status(404).send('Expense not found');
        }
        if (expense.status === 'paid') {
            return res.status(400).send('Cannot edit already paid expenses.');
        }
        res.render('edit', { expense });
    } catch (error) {
        res.status(500).send('Error reading expense data for edit.');
    }
});

// PUT /expenses/:id - Update Expense
app.put('/expenses/:id', async (req, res) => {
    const { person, item, cost } = req.body;

    try {
        let expenses = await readExpenses();
        const expenseIndex = expenses.findIndex(e => e.id === req.params.id);

        if (expenseIndex === -1) {
            return res.status(404).send('Expense not found');
        }

        if (expenses[expenseIndex].status === 'paid') {
            return res.status(400).send('Cannot edit already paid expenses.');
        }

        expenses[expenseIndex] = {
            ...expenses[expenseIndex],
            person: person.trim(),
            item: item.trim(),
            cost: parseFloat(cost),
        };

        await writeExpenses(expenses);
        res.redirect('/report');
    } catch (error) {
        res.status(500).send('Error updating expense data.');
    }
});

// DELETE /expenses/:id - Delete Expense
app.delete('/expenses/:id', async (req, res) => {
    try {
        let expenses = await readExpenses();
        const initialLength = expenses.length;
        expenses = expenses.filter(e => e.id !== req.params.id);

        if (expenses.length === initialLength) {
            return res.status(404).send('Expense not found');
        }

        await writeExpenses(expenses);
        res.redirect('/report');
    } catch (error) {
        res.status(500).send('Error deleting expense data.');
    }
});

// POST /mark-paid/:person - Mark Person's Expenses as Paid
app.post('/mark-paid/item/:id', async (req, res) => {
    const expenseId = req.params.id;
    const paidTimestamp = Date.now();
    const paidBatchId = `batch-${crypto.randomUUID()}`;

    try {
        let expenses = await readExpenses();
        const expenseIndex = expenses.findIndex(e => e.id === expenseId);

        if (expenseIndex === -1) {
            return res.status(404).send('Expense not found');
        }

        if (expenses[expenseIndex].status === 'paid') {
            return res.status(400).send('Item is already marked as paid.');
        }

        expenses[expenseIndex] = {
            ...expenses[expenseIndex],
            status: 'paid',
            paidTimestamp: paidTimestamp,
            paidBatchId: paidBatchId,
        };

        await writeExpenses(expenses);
        console.log(`Marked item ${expenseId} as paid in batch ${paidBatchId}`);
        res.redirect('/report');
    } catch (error) {
        res.status(500).send('Error updating expense data.');
    }
});

// GET /history - History Page (Paid Expenses)
app.get('/history', async (req, res) => {
    try {
        const expenses = await readExpenses();
        const paidExpenses = expenses.filter(e => e.status === 'paid');
        const historyBatches = {};

        paidExpenses.forEach(expense => {
            if (!expense.paidBatchId) return;

            if (!historyBatches[expense.paidBatchId]) {
                historyBatches[expense.paidBatchId] = {
                    person: expense.person,
                    timestamp: expense.paidTimestamp,
                    batchId: expense.paidBatchId,
                    items: [],
                    total: 0,
                };
            }
            expense.costFormatted = formatCurrency(expense.cost);
            historyBatches[expense.paidBatchId].items.push(expense);
            historyBatches[expense.paidBatchId].total += expense.cost;
        });

        const sortedHistory = Object.values(historyBatches).sort((a, b) => b.timestamp - a.timestamp);

        sortedHistory.forEach(batch => {
            batch.totalFormatted = formatCurrency(batch.total);
            batch.items.sort((a, b) => a.addedTimestamp - b.addedTimestamp);
        });

        res.render('history', { historyBatches: sortedHistory });
    } catch (error) {
        res.status(500).send('Error reading expense history.');
    }
});

// --- Start Server ---
app.listen(port, () => {
    console.log(`Cost splitting app listening at http://localhost:${port}`);
});