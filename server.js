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

        // Pass the formatCurrency function along with reportData
        res.render('report', { reportData, formatCurrency });
    } catch (error) {
        res.status(500).send('Error reading expense data for report.');
    }
});

// POST /mark-paid/:person - Mark Person's Expenses (all) as Paid
app.post('/mark-paid/:username', async (req, res) => {
    const username = req.params.username;
  
    try {
        const expenses = await readExpenses();
        const itemsToMarkAsPaid = expenses.filter(item => item.person === username && item.status !== 'paid');

        if (itemsToMarkAsPaid.length === 0) {
            return res.status(404).send(`No unpaid items found for ${username}`);
        }

        // Update all found items to 'paid'
        const updatedItems = itemsToMarkAsPaid.map(item => ({
            ...item,
            status: 'paid',
            paidTimestamp: Date.now(),
            paidBatchId: `batch-${crypto.randomUUID()}`
        }));

        // Filter out unpaid items from the expenses list and add the updated items
        const updatedExpenses = expenses.filter(item => !(item.person === username && item.status !== 'paid')).concat(updatedItems);

        await writeExpenses(updatedExpenses);

        res.redirect('/report');
    } catch (error) {
        res.status(500).send('Error marking expenses as paid.');
    }
});

// --- Start Server ---
app.listen(port, () => {
    console.log(`Cost splitting app listening at http://localhost:${port}`);
});
