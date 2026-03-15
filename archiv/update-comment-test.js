const ADODB = require("node-adodb");

const DB_PATH = "D:\\Farbspektrum\\n8n\\api\\access\\backend_db\\backend.accdb";
const connection = ADODB.open(
  `Provider=Microsoft.ACE.OLEDB.12.0;Data Source=${DB_PATH};Persist Security Info=False;`
);

// Tabellen/Spalten (fix nach deiner Beschreibung)
const TABLE = "tblAuftragDetails";
const COL_KDNR = "KdNr";                 // falls es wirklich KDNR heißt, ändere hier auf "KDNR"
const COL_AUFTRAGSID = "AuftragsID";
const COL_COMMENT = "voice_agent_comment";

// >>> Hier einen EXISTIERENDEN Datensatz eintragen <<<
// Nimm am besten einen AuftragDetails-Datensatz, der sicher vorhanden ist.
const TEST_KDNR = "001091";
const TEST_AUFTRAGSID = 5;

// Kommentartext
const NEW_COMMENT = `Voice-Agent Test (${new Date().toISOString()})`;

function escapeSqlString(value) {
  return String(value).replace(/'/g, "''");
}

async function run() {
  console.log("Starte UPDATE-Test (voice_agent_comment)…");
  console.log("DB:", DB_PATH);
  console.log("Key:", { [COL_KDNR]: TEST_KDNR, [COL_AUFTRAGSID]: TEST_AUFTRAGSID });

  try {
    // 1) Vorher auslesen (optional, aber lehrreich)
    const sqlBefore = `
      SELECT TOP 1 ${COL_KDNR}, ${COL_AUFTRAGSID}, ${COL_COMMENT}
      FROM ${TABLE}
      WHERE ${COL_KDNR} = '${escapeSqlString(TEST_KDNR)}'
        AND ${COL_AUFTRAGSID} = ${Number(TEST_AUFTRAGSID)};
    `.trim();

    console.log("SQL BEFORE:", sqlBefore);
    const before = await connection.query(sqlBefore);

    if (!before || before.length === 0) {
      console.log("Kein passender Datensatz gefunden. Bitte TEST_KDNR/TEST_AUFTRAGSID anpassen.");
      return;
    }

    console.log("Vorheriger Kommentar (gekürzt):");
    console.log(String(before[0][COL_COMMENT] ?? "").slice(0, 200));

    // 2) UPDATE (nur diese eine Spalte!)
    const sqlUpdate = `
      UPDATE ${TABLE}
      SET ${COL_COMMENT} = '${escapeSqlString(NEW_COMMENT)}'
      WHERE ${COL_KDNR} = '${escapeSqlString(TEST_KDNR)}'
        AND ${COL_AUFTRAGSID} = ${Number(TEST_AUFTRAGSID)};
    `.trim();

    console.log("SQL UPDATE:", sqlUpdate);
    await connection.execute(sqlUpdate);
    console.log("UPDATE OK.");

    // 3) Nachher auslesen
    const sqlAfter = `
      SELECT TOP 1 ${COL_KDNR}, ${COL_AUFTRAGSID}, ${COL_COMMENT}
      FROM ${TABLE}
      WHERE ${COL_KDNR} = '${escapeSqlString(TEST_KDNR)}'
        AND ${COL_AUFTRAGSID} = ${Number(TEST_AUFTRAGSID)};
    `.trim();

    console.log("SQL AFTER:", sqlAfter);
    const after = await connection.query(sqlAfter);

    console.log("Nachheriger Kommentar:");
    console.log(after[0][COL_COMMENT]);
  } catch (err) {
    console.error("FEHLER beim UPDATE-Test:");
    console.error(err);
    process.exitCode = 1;
  }
}

run();
