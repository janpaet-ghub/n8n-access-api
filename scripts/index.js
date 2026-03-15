const ADODB = require("node-adodb");

// 1) Pfad zu deiner Access-Datei anpassen:
const DB_PATH = "D:\\Farbspektrum\\n8n\\api\\access\\backend_db\\backend.accdb";

// 2) Provider: falls 12.0 nicht geht, später 16.0 testen
const connection = ADODB.open(
  `Provider=Microsoft.ACE.OLEDB.12.0;Data Source=${DB_PATH};Persist Security Info=False;`
);

// 3) Minimaltest: Tabelle abfragen (bitte anpassen)
const SQL = "SELECT TOP 1 * FROM tblAuftrag;";

async function run() {
  console.log("Starte Access-Test…");
  console.log("DB:", DB_PATH);
  console.log("SQL:", SQL);

  try {
    const rows = await connection.query(SQL);
    console.log("OK. Anzahl Zeilen:", rows.length);
    console.log("Erste Zeile:");
    console.log(JSON.stringify(rows[0], null, 2));
  } catch (err) {
    console.error("FEHLER beim Access-Zugriff:");
    console.error(err);
    process.exitCode = 1;
  }
}

run();
