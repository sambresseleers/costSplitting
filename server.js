const express = require('express');
const methodOverride = require('method-override');
const crypto = require('crypto'); // For generating unique IDs
const path = require('path');

const app = express();
const port = 3002;

// --- In-Memory Data Store ---
// WARNING: Data is lost when the server restarts! Use a database for persistence.
let expenses = [
    // Example structure:
    // { id: 'uuid', person: 'Martyna', item: 'Groceries', cost: 50.75, status: 'unpaid', addedTimestamp: Date.now(), paidTimestamp: null, paidBatchId: null },
    // { id: 'uuid2', person: 'Joint', item: 'Dinner', cost: 80.00, status: 'paid', addedTimestamp: Date.now()-10000, paidTimestamp: Date.now()-5000, paidBatchId: 'batch-uuid-1' }
];

// --- Middleware ---
app.set('view engine', 'ejs'); // Set EJS as the templating engine
app.set('views', path.join(__dirname, 'views')); // Specify views directory
app.use(express.urlencoded({ extended: true })); // Parse URL-encoded bodies (form data)
app.use(methodOverride('_method')); // Allow PUT/DELETE via query param ?_method=...
app.use(express.static(path.join(__dirname, 'public'))); // Serve static files (like CSS)

// --- Helper Functions ---
const formatCurrency = (amount) => {
    return new Intl.NumberFormat('nl-BE', { style: 'currency', currency: 'EUR' }).format(amount);
};

const PREFILLED_NAMES = ['Martyna', 'Joint', 'Mama'];

// --- Routes ---

// GET / - Input Form Page
app.get('/', (req, res) => {
    const prefillPerson = req.query.person || ''; // Get person name from query param
    res.render('index', { prefillPerson, names: PREFILLED_NAMES });
});

// POST /expenses - Add New Expense
app.post('/expenses', (req, res) => {
    const { person, item, cost } = req.body;

    // Basic Validation
    if (!person || !item || !cost || isNaN(parseFloat(cost))) {
        // Ideally, send an error message back to the form
        console.error("Validation failed:", req.body);
        return res.redirect('/?error=Invalid input'); // Redirect back with an error query
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
    expenses.push(newExpense);

    // Redirect logic
    if (PREFILLED_NAMES.includes(newExpense.person)) {
        res.redirect(`/?person=${encodeURIComponent(newExpense.person)}`); // Redirect back with person pre-filled
    } else {
        res.redirect('/'); // Redirect back to an empty form
    }
});

// GET /report - Report Page (Unpaid Expenses)
app.get('/report', (req, res) => {
    const unpaidExpenses = expenses.filter(e => e.status === 'unpaid');
    const reportData = {}; // { personName: { items: [], total: 0 }, ... }

    unpaidExpenses.forEach(expense => {
        if (!reportData[expense.person]) {
            reportData[expense.person] = { items: [], total: 0 };
        }
        reportData[expense.person].items.push(expense);
        reportData[expense.person].total += expense.cost;
    });

     // Sort items within each person by added timestamp (optional)
    Object.values(reportData).forEach(personData => {
        personData.items.sort((a, b) => a.addedTimestamp - b.addedTimestamp);
        personData.totalFormatted = formatCurrency(personData.total); // Format total here
    });

     // Format individual costs
     unpaidExpenses.forEach(expense => {
        expense.costFormatted = formatCurrency(expense.cost);
    });


    res.render('report', { reportData });
});

// GET /expenses/:id/edit - Show Edit Form
app.get('/expenses/:id/edit', (req, res) => {
    const expense = expenses.find(e => e.id === req.params.id);
    if (!expense) {
        return res.status(404).send('Expense not found');
    }
    if (expense.status === 'paid') {
         // Optionally prevent editing paid items or handle differently
         return res.status(400).send('Cannot edit already paid expenses.');
    }
    res.render('edit', { expense });
});

// PUT /expenses/:id - Update Expense
app.put('/expenses/:id', (req, res) => {
    const { person, item, cost } = req.body;
    const expenseIndex = expenses.findIndex(e => e.id === req.params.id);

    if (expenseIndex === -1) {
        return res.status(404).send('Expense not found');
    }

    // Basic Validation
    if (!person || !item || !cost || isNaN(parseFloat(cost))) {
        console.error("Validation failed during update:", req.body);
        // Redirect back to edit form with an error message?
        return res.redirect(`/expenses/${req.params.id}/edit?error=Invalid+input`);
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

    res.redirect('/report');
});

// DELETE /expenses/:id - Delete Expense
app.delete('/expenses/:id', (req, res) => {
    const initialLength = expenses.length;
    expenses = expenses.filter(e => e.id !== req.params.id);

    if (expenses.length === initialLength) {
         return res.status(404).send('Expense not found');
         // Or just redirect without error if deletion failure is acceptable
    }

    res.redirect('/report');
});

// POST /mark-paid/:person - Mark Person's Expenses as Paid
app.post('/mark-paid/:person', (req, res) => {
    const personName = req.params.person;
    const paidTimestamp = Date.now();
    const paidBatchId = `batch-${crypto.randomUUID()}`; // Unique ID for this payment batch
    let itemsMarked = 0;

    expenses.forEach(expense => {
        if (expense.person === personName && expense.status === 'unpaid') {
            expense.status = 'paid';
            expense.paidTimestamp = paidTimestamp;
            expense.paidBatchId = paidBatchId;
            itemsMarked++;
        }
    });

    if (itemsMarked > 0) {
        console.log(`Marked ${itemsMarked} items as paid for ${personName} in batch ${paidBatchId}`);
    } else {
        console.log(`No unpaid items found for ${personName} to mark as paid.`);
        // Optional: redirect with a message if nothing was paid
    }


    res.redirect('/report'); // Redirect back to report (paid items will disappear)
});

// GET /history - History Page (Paid Expenses)
app.get('/history', (req, res) => {
    const paidExpenses = expenses.filter(e => e.status === 'paid');

    // Group paid expenses by batch ID
    const historyBatches = {}; // { batchId: { person: '', timestamp: Date, items: [], total: 0 }, ... }

    paidExpenses.forEach(expense => {
        if (!expense.paidBatchId) return; // Skip if somehow missing batch ID

        if (!historyBatches[expense.paidBatchId]) {
            historyBatches[expense.paidBatchId] = {
                person: expense.person,
                timestamp: expense.paidTimestamp,
                batchId: expense.paidBatchId,
                items: [],
                total: 0,
            };
        }
        // Format cost within the batch item
        expense.costFormatted = formatCurrency(expense.cost);
        historyBatches[expense.paidBatchId].items.push(expense);
        historyBatches[expense.paidBatchId].total += expense.cost;
    });

    // Convert to array and sort batches by timestamp (most recent first)
    const sortedHistory = Object.values(historyBatches).sort((a, b) => b.timestamp - a.timestamp);

     // Format total for each batch
    sortedHistory.forEach(batch => {
        batch.totalFormatted = formatCurrency(batch.total);
        // Sort items within batch (optional, e.g., by original add time)
         batch.items.sort((a, b) => a.addedTimestamp - b.addedTimestamp);
    });


    res.render('history', { historyBatches: sortedHistory });
});

// --- Start Server ---
app.listen(port, () => {
    console.log(`Cost splitting app listening at http://localhost:${port}`);
});