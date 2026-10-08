import express from 'express';
import cors from 'cors';
import mysql from 'mysql2/promise';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';

const app = express();
app.use(cors());
app.use(express.json());

const SECRET = "shop_secret_2026";

// ===== CONNECT TO YOUR WORKBENCH =====
const db = await mysql.createPool({
  host: '127.0.0.1',
  user: 'root',
  password: 'Alvi@1234',
  database: 'shop_manager',
  port: 3306
});
console.log('✅ Workbench Connected! shop_manager is READY!');

// ======== CREATE USERS TABLE IF NOT EXISTS ========
await db.query(`
  CREATE TABLE IF NOT EXISTS users (
    id VARCHAR(50) PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    email VARCHAR(100) UNIQUE NOT NULL,
    password VARCHAR(255) NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  )
`);
console.log('✅ Users table ready!');

// ================= REAL AUTH =================
app.post('/api/register', async (req, res) => {
  try {
    const { name, email, password } = req.body;
    if (!name ||!email ||!password) return res.status(400).json({ error: "All fields required" });

    const [exists] = await db.query('SELECT id FROM users WHERE email=?', [email]);
    if (exists.length > 0) return res.status(400).json({ error: "Email already exists" });

    const hashed = await bcrypt.hash(password, 10);
    const id = Date.now().toString();

    await db.query('INSERT INTO users (id, name, email, password) VALUES (?,?,?,?)',
      [id, name, email, hashed]);

    res.json({ message: "Registered successfully!" });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    const [rows] = await db.query('SELECT * FROM users WHERE email=?', [email]);
    if (rows.length === 0) return res.status(400).json({ error: "User not found" });

    const user = rows[0];
    const match = await bcrypt.compare(password, user.password);
    if (!match) return res.status(400).json({ error: "Wrong password" });

    const token = jwt.sign({ id: user.id, email: user.email }, SECRET, { expiresIn: '1d' });
    res.json({ message: "Login success", token, user: { id: user.id, name: user.name, email: user.email } });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ================= PRODUCTS =================
app.get('/api/products', async (req,res)=>{
  const [rows] = await db.query('SELECT * FROM products');
  res.json(rows);
});

app.post('/api/products', async (req,res)=>{
  const id = Date.now().toString();
  const {name, price, stock, category} = req.body;
  await db.query('INSERT INTO products (id,name,price,stock,category) VALUES (?,?,?,?,?)',
    [id, name, price, Number(stock||0), category||'general']);
  res.json({id, name});
});

app.put('/api/products/:id', async (req,res)=>{
  const {name, price, stock, category} = req.body;
  await db.query('UPDATE products SET name=?, price=?, stock=?, category=? WHERE id=?',
    [name, price, stock, category, req.params.id]);
  res.json({success:true});
});

app.delete('/api/products/:id', async (req,res)=>{
  await db.query('DELETE FROM products WHERE id=?', [req.params.id]);
  res.json({success:true});
});

// ================= CUSTOMERS =================
app.get('/api/customers', async (req,res)=>{
  const [customers] = await db.query('SELECT * FROM customers');
  const [sales] = await db.query('SELECT * FROM sales');
  for(const s of sales){
    const n = (s.customer||'').trim();
    if(!n || n.toLowerCase()==='walk-in customer') continue;
    if(!customers.find(c=> c.name.toLowerCase()===n.toLowerCase())){
      const newId = n.toLowerCase().replace(/\s+/g,'_');
      await db.query('INSERT IGNORE INTO customers (id,name,joined) VALUES (?,?,?)', [newId, n, s.date]);
    }
  }
  const [updatedCustomers] = await db.query('SELECT * FROM customers');
  const result = updatedCustomers.map(c=>{
    const cs = sales.filter(s=> (s.customer||'').toLowerCase()===c.name.toLowerCase());
    const tot = cs.reduce((a,b)=> a+Number(b.amount||0),0);
    return {...c, totalSpent: tot, orders: cs.length};
  });
  res.json(result);
});

app.post('/api/customers', async (req,res)=>{
  const id = req.body.name.toLowerCase().replace(/\s+/g,'_');
  const {name,email,phone} = req.body;
  await db.query('INSERT INTO customers (id,name,email,phone,joined) VALUES (?,?,?,?,CURDATE())',
    [id, name, email||'', phone||'']);
  res.json({id, name});
});

app.put('/api/customers/:id', async (req,res)=>{
  const [old] = await db.query('SELECT name FROM customers WHERE id=?', [req.params.id]);
  if(old.length===0) return res.status(404).json({error:'Not found, reload page'});
  const oldName = old[0].name;
  const newName = req.body.name.trim();
  const newId = newName.toLowerCase().replace(/\s+/g,'_');
  await db.query('UPDATE customers SET id=?, name=?, email=?, phone=? WHERE id=?',
    [newId, newName, req.body.email, req.body.phone, req.params.id]);
  await db.query('UPDATE sales SET customer=? WHERE customer=?', [newName, oldName]);
  res.json({id:newId, name:newName});
});

app.delete('/api/customers/:id', async (req,res)=>{
  await db.query('DELETE FROM customers WHERE id=?', [req.params.id]);
  res.json({success:true});
});

// ================= SALES =================
app.get('/api/sales', async (req,res)=>{
  const [rows] = await db.query('SELECT * FROM sales ORDER BY date DESC');
  res.json(rows);
});

app.post('/api/sales', async (req,res)=>{
  const {productId, quantity, customer, amount} = req.body;
  const qty = Number(quantity||1);
  const [prodRows] = await db.query('SELECT * FROM products WHERE id=?', [productId]);
  const prod = prodRows[0];
  if(prod){
    if(Number(prod.stock) <= 0) return res.status(400).json({error:`${prod.name} has 0 stock`});
    if(Number(prod.stock) < qty) return res.status(400).json({error:`Only ${prod.stock} left for ${prod.name}`});
    await db.query('UPDATE products SET stock=stock-? WHERE id=?', [qty, productId]);
  }
  const id = Date.now().toString();
  const today = new Date().toISOString().split('T')[0];
  const custName = customer||'Walk-in Customer';
  await db.query('INSERT INTO sales (id,productId,quantity,customer,amount,date) VALUES (?,?,?,?,?,?)',
    [id, productId, qty, custName, Number(amount||0), today]);
  if(custName.toLowerCase()!=='walk-in customer'){
    const cid = custName.toLowerCase().replace(/\s+/g,'_');
    const [ex] = await db.query('SELECT id FROM customers WHERE LOWER(name)=LOWER(?)', [custName]);
    if(ex.length===0){
      await db.query('INSERT INTO customers (id,name,joined) VALUES (?,?,?)', [cid, custName, today]);
    }
  }
  res.json({id});
});

app.delete('/api/sales/:id', async (req,res)=>{
  await db.query('DELETE FROM sales WHERE id=?', [req.params.id]);
  res.json({success:true});
});

// ================= DASHBOARD =================
app.get('/api/dashboard', async (req,res)=>{
  const [s] = await db.query('SELECT SUM(amount) as totalRevenue, COUNT(*) as totalSales FROM sales');
  const [p] = await db.query('SELECT COUNT(*) as totalProducts FROM products');
  const [c] = await db.query('SELECT COUNT(*) as totalCustomers FROM customers');
  const [l] = await db.query('SELECT COUNT(*) as lowStock FROM products WHERE stock <=5');
  const [recent] = await db.query('SELECT * FROM sales ORDER BY date DESC LIMIT 5');
  res.json({
    totalRevenue: s[0].totalRevenue||0,
    totalSales: s[0].totalSales||0,
    totalProducts: p[0].totalProducts||0,
    totalCustomers: c[0].totalCustomers||0,
    lowStock: l[0].lowStock||0,
    recentSales: recent
  });
});

app.listen(5000, ()=> console.log('🚀 Backend running on 5000 - WORKBENCH CONNECTED + REAL AUTH!'));