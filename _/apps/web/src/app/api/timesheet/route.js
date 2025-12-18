import sql from "@/app/api/utils/sql";

// GET - Recupera tutte le ore per un mese/anno
export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const year = parseInt(searchParams.get("year"));
    const month = parseInt(searchParams.get("month"));

    if (!year || month < 0 || month > 11) {
      return Response.json(
        { error: "Year and month are required" },
        { status: 400 },
      );
    }

    const entries = await sql`
      SELECT day, hours, site, worksite
      FROM timesheet_entries 
      WHERE year = ${year} AND month = ${month}
      ORDER BY day ASC
    `;

    // Converte in formato oggetto per il frontend
    const entriesObj = {};
    entries.forEach((entry) => {
      const key = `${year}-${month}-${entry.day}`;
      entriesObj[key] = {
        hours: entry.hours?.toString() || "",
        site: entry.site || "",
        worksite: entry.worksite || "",
      };
    });

    return Response.json({ entries: entriesObj });
  } catch (error) {
    console.error("Error fetching timesheet:", error);
    return Response.json(
      { error: "Failed to fetch timesheet" },
      { status: 500 },
    );
  }
}

// POST - Salva o aggiorna una voce timesheet
export async function POST(request) {
  try {
    const { year, month, day, hours, site, worksite } = await request.json();

    if (!year || month < 0 || month > 11 || !day || day < 1 || day > 31) {
      return Response.json(
        { error: "Invalid date parameters" },
        { status: 400 },
      );
    }

    // Upsert: inserisci o aggiorna se esiste già
    const result = await sql`
      INSERT INTO timesheet_entries (year, month, day, hours, site, worksite, updated_at)
      VALUES (${year}, ${month}, ${day}, ${hours || null}, ${site || ""}, ${worksite || ""}, CURRENT_TIMESTAMP)
      ON CONFLICT (year, month, day)
      DO UPDATE SET 
        hours = ${hours || null},
        site = ${site || ""},
        worksite = ${worksite || ""},
        updated_at = CURRENT_TIMESTAMP
      RETURNING *
    `;

    return Response.json({ success: true, entry: result[0] });
  } catch (error) {
    console.error("Error saving timesheet entry:", error);
    return Response.json(
      { error: "Failed to save timesheet entry" },
      { status: 500 },
    );
  }
}

// DELETE - Azzera tutti i dati per un mese/anno (quando si scarica PDF)
export async function DELETE(request) {
  try {
    const { searchParams } = new URL(request.url);
    const year = parseInt(searchParams.get("year"));
    const month = parseInt(searchParams.get("month"));

    if (!year || month < 0 || month > 11) {
      return Response.json(
        { error: "Year and month are required" },
        { status: 400 },
      );
    }

    await sql`
      DELETE FROM timesheet_entries 
      WHERE year = ${year} AND month = ${month}
    `;

    return Response.json({ success: true, message: "Timesheet cleared" });
  } catch (error) {
    console.error("Error clearing timesheet:", error);
    return Response.json(
      { error: "Failed to clear timesheet" },
      { status: 500 },
    );
  }
}
