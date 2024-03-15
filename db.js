const { Client } = require('pg');

const client = new Client({
    connectionString: process.env.POSTGRES_URL
});


client.connect();

module.exports = client;