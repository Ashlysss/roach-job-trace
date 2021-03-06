const express = require('express');
const path = require('path');
const { Pool } = require("pg");

//Init App
const app = express();

const config = {
  user: "max",
  password: "roach",
  host: "localhost",
  database: "jobs",
  port: 26257,
  ssl: {
    rejectUnauthorized: false,
  },
  //For secure connection:
  /*ssl: {
        ca: fs.readFileSync('/certs/ca.crt')
            .toString()
    }*/
};

// Create a connection pool

const pool = new Pool(config);

// Wrapper for a transaction.  This automatically re-calls the operation with
// the client as an argument as long as the database server asks for
// the transaction to be retried.

async function retryTxn(n, max, client, operation, callback) {
  await client.query("BEGIN;");
  while (true) {
    n++;
    if (n === max) {
      throw new Error("Max retry count reached.");
    }
    try {
      await operation(client, callback);
      await client.query("COMMIT;");
      return;
    } catch (err) {
      if (err.code !== "40001") {
        return callback(err);
      } else {
        console.log("Transaction failed. Retrying transaction.");
        console.log(err.message);
        await client.query("ROLLBACK;", () => {
          console.log("Rolling back transaction.");
        });
        await new Promise((r) => setTimeout(r, 2 ** n * 1000));
      }
    }
  }
}

// This function is called within the first transaction. It creates a table and inserts some initial values.

async function initTable(client, callback) {
  await client.query(
    "CREATE TABLE IF NOT EXISTS accounts (id INT PRIMARY KEY, balance INT);",
    callback
  );
  await client.query(
    "INSERT INTO accounts (id, balance) VALUES (1, 1000), (2, 250);",
    callback
  );
  await client.query("SELECT id, balance FROM accounts;", callback);
}

async function transferFunds(client, callback) {
  const from = 1;
  const to = 2;
  const amount = 100;
  const selectFromBalanceStatement = "SELECT balance FROM accounts WHERE id = $1 ;";
  const selectFromValues = [from];
  await client.query(selectFromBalanceStatement, selectFromValues, (err, res) => {
    if (err) {
      return callback(err);
    } else if (res.rows.length === 0) {
      console.log("account not found in table");
      return callback(err);
    }
    var acctBal = res.rows[0].balance;
    if (acctBal < amount) {
      return callback(new Error("insufficient funds"));
    }
  });

  const updateFromBalanceStatement = "UPDATE accounts SET balance = balance - $1 WHERE id = $2 ;";
  const updateFromValues = [amount, from];
  await client.query(updateFromBalanceStatement, updateFromValues, callback);

  const updateToBalanceStatement = "UPDATE accounts SET balance = balance + $1 WHERE id = $2 ;";
  const updateToValues = [amount, to];
  await client.query(updateToBalanceStatement, updateToValues, callback);

  const selectBalanceStatement = "SELECT id, balance FROM accounts;";
  await client.query(selectBalanceStatement, callback);
}

// Run the transactions in the connection pool

(async () => {
  // Connect to database
  const client = await pool.connect();

  // Callback
  function cb(err, res) {
    if (err) throw err;

    if (res.rows.length > 0) {
      console.log("New account balances:");
      res.rows.forEach((row) => {
        console.log(row);
      });
    }
  }

  // Initialize table in transaction retry wrapper
  console.log("Initializing table...");
  await retryTxn(0, 15, client, initTable, cb);

  // Transfer funds in transaction retry wrapper
  console.log("Transferring funds...");
  await retryTxn(0, 15, client, transferFunds, cb);

  // Exit program
  process.exit();
})().catch((err) => console.log(err.stack));

//Load View Engine
app.set('views',path.join(__dirname,'views'));
app.set('view engine','pug');

//Home Route
app.get('/', function(req,res){
  res.render('index',{
    title:'Hello'
  });
});

//Add Job Apps
app.get('/job/add', function(req,res){
  res.render('add',{
    title:'Log Job Apps'
  });
});


//Start Server
app.listen(3000,function(){
  console.log('Server started on port 3000.......');
});
