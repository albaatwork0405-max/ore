import { useState, useEffect, useMemo, useCallback, useRef, useLayoutEffect } from "react";
import {
  Calendar,
  Clock,
  FileText,
  Building,
  Download,
  Camera,
} from "lucide-react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import "./page.css";

function useScreenshot({ ref }) {
  const [image, setImage] = useState(null);
  const [isLoading, setIsLoading] = useState(false);

  const takeScreenshot = useCallback(async (opts = {}) => {
    if (!ref?.current) return null;
    setIsLoading(true);
    try {
      const { toJpeg } = await import("html-to-image");
      const node = ref.current;
      const clone = node.cloneNode(true);
      clone.style.transform = "scale(1)";
      clone.style.transformOrigin = "top left";
      try { clone.className = ""; } catch (e) {}

      const visualWidth = Math.round(node.getBoundingClientRect().width) || node.scrollWidth || node.offsetWidth || 794;
      clone.style.width = visualWidth + "px";
      clone.style.boxSizing = "border-box";

      const off = document.createElement("div");
      off.style.position = "fixed";
      off.style.top = "-9999px";
      off.style.left = "-9999px";
      off.style.background = opts.backgroundColor || "#fff";
      off.style.overflow = "visible";
      off.appendChild(clone);
      document.body.appendChild(off);

      const dataUrl = await toJpeg(clone, {
        cacheBust: true,
        backgroundColor: opts.backgroundColor || "#fff",
        pixelRatio: opts.pixelRatio ?? 1,
        quality: opts.quality ?? 0.95,
      });

      document.body.removeChild(off);
      setImage(dataUrl);
      return dataUrl;
    } catch (err) {
      console.error("useScreenshot error:", err);
      return null;
    } finally {
      setIsLoading(false);
    }
  }, [ref]);

  const clear = useCallback(() => setImage(null), []);

  return { image, takeScreenshot, isLoading, clear };
}

export default function LinkInBioApp() {
  const [selectedMonth, setSelectedMonth] = useState(new Date().getMonth());
  const [selectedYear, setSelectedYear] = useState(new Date().getFullYear());
  const [isGeneratingPDF, setIsGeneratingPDF] = useState(false);
  const [showScreenshotView, setShowScreenshotView] = useState(false);
  const queryClient = useQueryClient();
  const reportRef = useRef(null);
  const tableRef = useRef(null);

  useEffect(() => {
    // When screenshot overlay is open, prevent background/body scrolling
    if (showScreenshotView) {
      const prev = document.body.style.overflow;
      document.body.style.overflow = "hidden";

      // expand report container to its full content width while screenshot view is open
      let prevMaxWidth, prevWidth;
      if (reportRef && reportRef.current) {
        const el = reportRef.current;
        prevMaxWidth = el.style.maxWidth;
        prevWidth = el.style.width;
        el.style.maxWidth = "none";
        el.style.width = "max-content";
      }

      return () => {
        document.body.style.overflow = prev;
        if (reportRef && reportRef.current) {
          const el = reportRef.current;
          el.style.maxWidth = prevMaxWidth || "";
          el.style.width = prevWidth || "";
        }
      };
    }
    return undefined;
  }, [showScreenshotView]);

  const months = [
    "Gennaio",
    "Febbraio",
    "Marzo",
    "Aprile",
    "Maggio",
    "Giugno",
    "Luglio",
    "Agosto",
    "Settembre",
    "Ottobre",
    "Novembre",
    "Dicembre",
  ];

  const dayNames = ["Dom", "Lun", "Mar", "Mer", "Gio", "Ven", "Sab"];

  const years = useMemo(() => {
    const currentYear = new Date().getFullYear();
    return Array.from({ length: 5 }, (_, i) => currentYear - 2 + i);
  }, []);

  const daysInMonth = useMemo(() => {
    return new Date(selectedYear, selectedMonth + 1, 0).getDate();
  }, [selectedMonth, selectedYear]);

  const days = useMemo(() => {
    return Array.from({ length: daysInMonth }, (_, i) => i + 1);
  }, [daysInMonth]);

  // Query per recuperare i dati del mese corrente
  const { data: timesheetData, isLoading } = useQuery({
    queryKey: ["timesheet", selectedYear, selectedMonth],
    queryFn: async () => {
      const response = await fetch(
        `/api/timesheet?year=${selectedYear}&month=${selectedMonth}`,
      );
      if (!response.ok) {
        throw new Error("Failed to fetch timesheet");
      }
      const data = await response.json();
      return data.entries || {};
    },
  });

  // Mutation per salvare una voce
  const saveEntryMutation = useMutation({
    mutationFn: async ({ year, month, day, hours, site, worksite }) => {
      const response = await fetch("/api/timesheet", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ year, month, day, hours, site, worksite }),
      });
      if (!response.ok) {
        throw new Error("Failed to save entry");
      }
      return response.json();
    },
    onSuccess: () => {
      // Refresh dei dati
      queryClient.invalidateQueries({
        queryKey: ["timesheet", selectedYear, selectedMonth],
      });
    },
    onError: (error) => {
      console.error("Error saving entry:", error);
    },
  });

  // Mutation per cancellare tutti i dati del mese (dopo PDF)
  const clearMonthMutation = useMutation({
    mutationFn: async ({ year, month }) => {
      const response = await fetch(
        `/api/timesheet?year=${year}&month=${month}`,
        {
          method: "DELETE",
        },
      );
      if (!response.ok) {
        throw new Error("Failed to clear month data");
      }
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["timesheet", selectedYear, selectedMonth],
      });
    },
  });

  // PDF generation: POST the report HTML to the server and download the returned PDF blob
  const generatePDF = async () => {
    if (!reportRef?.current) {
      alert("Report non disponibile per la generazione PDF");
      return;
    }
    setIsGeneratingPDF(true);
    try {
      const html = reportRef.current.innerHTML;
      const response = await fetch("/integrations/pdf-generation/pdf", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ html }),
      });
      if (!response.ok) {
        const text = await response.text();
        throw new Error(text || "Server error");
      }
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      try { window.open(url, "_blank"); } catch (e) {}
      const a = document.createElement("a");
      a.href = url;
      a.download = `Rapporto_${months[selectedMonth]}_${selectedYear}.pdf`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 5000);
    } catch (err) {
      console.error("Error generating PDF:", err);
      alert("Errore nella generazione del PDF");
    } finally {
      setIsGeneratingPDF(false);
    }
  };

  // Funzione per aggiornare una voce (con debounce automatico)
  const updateTimeEntry = useCallback(
    (day, field, value) => {
      // Salva immediatamente nel database
      const currentEntry = getTimeEntry(day);
      const updatedEntry = {
        ...currentEntry,
        [field]: value,
      };

      saveEntryMutation.mutate({
        year: selectedYear,
        month: selectedMonth,
        day,
        hours: updatedEntry.hours ? parseFloat(updatedEntry.hours) : null,
        site: updatedEntry.site,
        worksite: updatedEntry.worksite,
      });
    },
    [selectedYear, selectedMonth, saveEntryMutation],
  );

  const getTimeEntry = (day) => {
    const key = `${selectedYear}-${selectedMonth}-${day}`;
    return timesheetData?.[key] || { hours: "", site: "", worksite: "" };
  };

  const totalHours = useMemo(() => {
    if (!timesheetData) return 0;
    return days.reduce((total, day) => {
      const entry = getTimeEntry(day);
      const hours = parseFloat(entry.hours) || 0;
      return total + hours;
    }, 0);
  }, [days, timesheetData, selectedMonth, selectedYear]);

  const getDayName = (day) => {
    const dayOfWeek = new Date(selectedYear, selectedMonth, day).getDay();
    return dayNames[dayOfWeek];
  };



  // Screenshot View Component: full-page PDF-like layout (A4-ish) + Scarica PNG ad alta risoluzione
  const ScreenshotView = () => {
    const contentRef = useRef(null);
    const wrapperRef = useRef(null);
    const [scale, setScale] = useState(1);
    const { image: hookImage, takeScreenshot, isLoading: isTaking, clear: clearScreenshot } = useScreenshot({ ref: contentRef });

    // Target page width (approx A4 in CSS px at 96dpi)
    const pageWidth = 794; // ~ A4 210mm * 96dpi / 25.4

    // Improve PNG resolution using at least 2x pixelRatio
    const getPixelRatio = () => Math.max(2, window.devicePixelRatio || 2);

    // Compute scale so the whole content fits into viewport
    useLayoutEffect(() => {
      const compute = () => {
        if (!contentRef.current || !wrapperRef.current) return;
        const contentHeight = contentRef.current.scrollHeight;
        const contentWidth = pageWidth; // fixed layout
        const availableHeight = window.innerHeight * 0.86; // leave space for padding and buttons
        const availableWidth = Math.min(window.innerWidth * 0.96, pageWidth);

        const scaleByHeight = availableHeight / contentHeight;
        const scaleByWidth = availableWidth / contentWidth;
        let newScale = Math.min(1, scaleByHeight, scaleByWidth);
        // don't scale too small
        newScale = Math.max(0.35, newScale);
        setScale(newScale);
      };

      compute();
      window.addEventListener("resize", compute);
      return () => window.removeEventListener("resize", compute);
    }, [days, selectedMonth, selectedYear]);

    const handleDownloadPNG = async () => {
      // Generate a JPEG instead of PNG so mobile devices can save to gallery more easily
      try {
        const { toJpeg } = await import("html-to-image");
        // Prefer the table element when present (user asked to capture only the table)
        const source = tableRef?.current || reportRef?.current || contentRef.current || wrapperRef.current;
        if (!source) return;

        const clone = source.cloneNode(true);
        clone.style.transform = "scale(1)";
        clone.style.transformOrigin = "top left";
        try { clone.className = ""; } catch (e) { /* ignore */ }
        // Match the on-screen visual size (use wrapper bounding box) and export at 1x to keep dimensions equal to the view
        const visualWidth = (wrapperRef && wrapperRef.current)
          ? Math.round(wrapperRef.current.getBoundingClientRect().width)
          : (source.scrollWidth || source.offsetWidth || (pageWidth - 64));
        // set clone width to visual width so exported image matches what the user sees
        clone.style.width = visualWidth + "px";
        clone.style.boxSizing = "border-box";

        const off = document.createElement("div");
        off.style.position = "fixed";
        off.style.top = "-9999px";
        off.style.left = "-9999px";
        off.style.background = "#fff";
        off.style.overflow = "visible";
        off.appendChild(clone);
        document.body.appendChild(off);

        // Use pixelRatio=1 to keep output pixel dimensions equal to visual CSS pixels
        const dataUrl = await toJpeg(clone, {
          cacheBust: true,
          backgroundColor: "#ffffff",
          pixelRatio: 1,
          quality: 0.95,
        });

        document.body.removeChild(off);

        // Convert dataUrl to blob so mobile download works better
        const res = await fetch(dataUrl);
        const blob = await res.blob();
        const url = URL.createObjectURL(blob);

        // Open image in new tab on mobile so users can save to gallery easily, then trigger download
        try { window.open(url, "_blank"); } catch (e) { /* ignore */ }

        const a = document.createElement("a");
        a.href = url;
        a.download = `Rapporto_${months[selectedMonth]}_${selectedYear}.jpg`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        setTimeout(() => URL.revokeObjectURL(url), 5000);
      } catch (err) {
        console.error("Error generating JPG:", err);
        alert("Errore nella generazione dell'immagine");
      }
    };

    return (
      <div className="fixed inset-0 bg-gray-200 z-50 p-6 overflow-auto flex items-start justify-center">
        <div className="w-full max-w-[96vw]">
          <div className="flex justify-end mb-3 print:hidden gap-2">
            <button
              onClick={handleDownloadPNG}
              className="flex items-center gap-2 bg-blue-600 text-white px-3 py-1 rounded text-sm hover:bg-blue-700"
            >
              <Download size={12} />
              Scarica tabella JPG
            </button>

            <button
              onClick={async () => {
                try {
                  const dataUrl = await takeScreenshot({ pixelRatio: 1, quality: 0.95 });
                  if (!dataUrl) return;
                  const res = await fetch(dataUrl);
                  const blob = await res.blob();
                  const url = URL.createObjectURL(blob);
                  try { window.open(url, "_blank"); } catch (e) {}
                  const a = document.createElement("a");
                  a.href = url;
                  a.download = `Rapporto_${months[selectedMonth]}_${selectedYear}_hook.jpg`;
                  document.body.appendChild(a);
                  a.click();
                  document.body.removeChild(a);
                  setTimeout(() => URL.revokeObjectURL(url), 5000);
                } catch (err) {
                  console.error(err);
                  alert("Errore nello screenshot (hook)");
                }
              }}
              className="flex items-center gap-2 bg-indigo-600 text-white px-3 py-1 rounded text-sm hover:bg-indigo-700"
            >
              <Camera size={12} />
              Scarica (hook) JPG
            </button>

            <button
              onClick={() => setShowScreenshotView(false)}
              className="bg-gray-500 text-white px-3 py-1 rounded text-sm hover:bg-gray-600"
            >
              Chiudi
            </button>
          </div>

          {/* Page container similar to PDF */}
          <div
            ref={wrapperRef}
            className="mx-auto bg-white shadow-sm"
            style={{
              width: "max-content",
              minHeight: Math.round(1122 * scale),
              padding: 32 * scale,
              border: "1px solid #111",
              transform: `scale(${scale})`,
              transformOrigin: "top left",
            }}
          >
            <div ref={contentRef} style={{ width: pageWidth - 64 }}>
              <div style={{ textAlign: "center", marginBottom: 18 }}>
                <div style={{ display: "inline-block", border: "1px solid #111", padding: "8px 24px" }}>
                  <h1 style={{ margin: 0, fontSize: 22, fontWeight: 700 }}>Rapporto Mensile</h1>
                </div>
              </div>

              <table style={{ width: "100%", borderCollapse: "collapse", marginBottom: 18 }}>
                <tbody>
                  <tr>
                    <td style={{ border: "1px solid #111", padding: 6, fontWeight: 600, width: "50%" }}>Nome Cognome</td>
                    <td style={{ border: "1px solid #111", padding: 6, fontWeight: 600, width: "50%" }}>Mese Anno</td>
                  </tr>
                  <tr>
                    <td style={{ border: "1px solid #111", padding: 6 }}>Ferjat Myrtaj</td>
                    <td style={{ border: "1px solid #111", padding: 6 }}>{months[selectedMonth]} {selectedYear}</td>
                  </tr>
                </tbody>
              </table>

              <table ref={tableRef} style={{ width: "100%", borderCollapse: "collapse", fontSize: 14 }}>
                <thead>
                  <tr>
                    <th style={{ border: "1px solid #111", padding: 6, textAlign: "left", width: 80 }}>Giorno</th>
                    <th style={{ border: "1px solid #111", padding: 6, textAlign: "center", width: 100 }}>Ore ordinarie</th>
                    <th style={{ border: "1px solid #111", padding: 6, textAlign: "left" }}>Note</th>
                    <th style={{ border: "1px solid #111", padding: 6, textAlign: "left", width: 160 }}>Cantiere</th>
                  </tr>
                </thead>
                <tbody>
                  {days.map((day) => {
                    const entry = getTimeEntry(day);
                    const dayOfWeek = new Date(selectedYear, selectedMonth, day).getDay();
                    const isWeekend = dayOfWeek === 0 || dayOfWeek === 6;

                    return (
                      <tr key={day}>
                        <td style={{ border: "1px solid #111", padding: 6 }}>{day} {dayNames[dayOfWeek]}</td>
                        <td style={{ border: "1px solid #111", padding: 6, textAlign: "center" }}>{entry.hours || "-"}</td>
                        <td style={{ border: "1px solid #111", padding: 6 }}>{entry.site || ""}</td>
                        <td style={{ border: "1px solid #111", padding: 6 }}>{entry.worksite || ""}</td>
                      </tr>
                    );
                  })}
                  <tr>
                    <td style={{ border: "1px solid #111", padding: 6, fontWeight: 700 }}>Tot.</td>
                    <td style={{ border: "1px solid #111", padding: 6, textAlign: "center", fontWeight: 700 }}>{Math.floor(totalHours)}</td>
                    <td style={{ border: "1px solid #111", padding: 6 }}></td>
                    <td style={{ border: "1px solid #111", padding: 6 }}></td>
                  </tr>
                </tbody>
              </table>

              <div style={{ textAlign: "center", marginTop: 20, fontWeight: 700 }}>TOT : {Math.floor(totalHours)} ore</div>
            </div>
          </div>

          <div className="text-xs text-gray-500 mt-3 text-center">Suggerimento: la tabella è adattata per stare tutta in una singola schermata; premi <strong>Scarica tabella JPG</strong> per ottenere l'immagine della sola tabella.</div>
        </div>

        <style jsx global>{`
          @media print {
            .print\\:hidden { display: none !important; }
            body { margin: 0; padding: 0; }
            @page { size: A4 portrait; margin: 16mm; }
          }
        `}</style>
      </div>
    );
  };

  if (showScreenshotView) {
    return <ScreenshotView />;
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 p-4">
      <div className="max-w-4xl mx-auto">
        {/* Header */}
        <div className="text-center mb-8">
          <h1 className="text-3xl font-bold text-gray-800 mb-2">
            RAPPORTO MENSILE
          </h1>
          <h2 className="text-xl font-semibold text-gray-600 mb-1">
            Nome, Cognome: Ferjat Myrtaj
          </h2>
          <p className="text-gray-600">Traccia le tue ore di lavoro</p>
        </div>

        {/* Month/Year Selectors */}
        <div className="bg-white rounded-lg shadow-md p-6 mb-6">
          <div className="flex flex-col sm:flex-row gap-4 items-center justify-center">
            <div className="flex items-center gap-2">
              <Calendar className="text-blue-600" size={20} />
              <label className="font-medium text-gray-700">Mese:</label>
              <select
                value={selectedMonth}
                onChange={(e) => setSelectedMonth(parseInt(e.target.value))}
                className="border border-gray-300 rounded-md px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                {months.map((month, index) => (
                  <option key={index} value={index}>
                    {month}
                  </option>
                ))}
              </select>
            </div>

            <div className="flex items-center gap-2">
              <label className="font-medium text-gray-700">Anno:</label>
              <select
                value={selectedYear}
                onChange={(e) => setSelectedYear(parseInt(e.target.value))}
                className="border border-gray-300 rounded-md px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                {years.map((year) => (
                  <option key={year} value={year}>
                    {year}
                  </option>
                ))}
              </select>
            </div>

            <button
              onClick={() => setShowScreenshotView(true)}
              className="flex items-center gap-2 bg-green-600 text-white px-4 py-2 rounded-md hover:bg-green-700"
            >
              <Camera size={16} />
              Vista Screenshot
            </button>

            <button
              onClick={generatePDF}
              disabled={isGeneratingPDF}
              className="flex items-center gap-2 bg-blue-600 text-white px-4 py-2 rounded-md hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <Download size={16} />
              {isGeneratingPDF ? "Generando..." : "Scarica PDF"}
            </button>
          </div>
        </div>

        {/* Timesheet Table */}
        <div ref={reportRef} className="bg-white rounded-lg shadow-md overflow-hidden">
          <div className="p-6">
            <h2 className="text-xl font-semibold text-gray-800 mb-4">
              {months[selectedMonth]} {selectedYear}
            </h2>

            <div className="sm:overflow-visible">
              <div className="overflow-x-auto max-h-[50vh] sm:max-h-none overflow-y-auto">
                <table ref={tableRef} className="w-full">
                  <thead>
                    <tr className="border-b border-gray-200">
                      <th className="text-left py-3 px-4 font-medium text-gray-700">
                      Giorno
                    </th>
                    <th className="text-left py-3 px-4 font-medium text-gray-700">
                      <div className="flex items-center gap-2">
                        <Clock size={16} />
                        Ore
                      </div>
                    </th>
                    <th className="text-left py-3 px-4 font-medium text-gray-700">
                      <div className="flex items-center gap-2">
                        <FileText size={16} />
                        Note
                      </div>
                    </th>
                    <th className="text-left py-3 px-4 font-medium text-gray-700">
                      <div className="flex items-center gap-2">
                        <Building size={16} />
                        Cantiere
                      </div>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {days.map((day) => {
                    const entry = getTimeEntry(day);
                    const dayOfWeek = new Date(
                      selectedYear,
                      selectedMonth,
                      day,
                    ).getDay();
                    const isWeekend = dayOfWeek === 0 || dayOfWeek === 6;
                    const dayName = getDayName(day);

                    return (
                      <tr
                        key={day}
                        className={`border-b border-gray-100 hover:bg-gray-50 ${
                          isWeekend ? "bg-gray-50" : ""
                        }`}
                      >
                        <td className="py-3 px-4">
                          <div className="flex items-center gap-2">
                            <span className="font-medium">
                              {day} {dayName}
                            </span>
                            {isWeekend && (
                              <span className="text-xs text-gray-500 bg-gray-200 px-2 py-1 rounded">
                                Weekend
                              </span>
                            )}
                          </div>
                        </td>
                        <td className="py-3 px-4">
                          <input
                            type="number"
                            step="0.5"
                            min="0"
                            max="24"
                            value={entry.hours}
                            onChange={(e) =>
                              updateTimeEntry(day, "hours", e.target.value)
                            }
                            className="w-20 border border-gray-300 rounded px-2 py-1 focus:outline-none focus:ring-2 focus:ring-blue-500"
                            placeholder="0"
                          />
                        </td>
                        <td className="py-3 px-4 min-w-0">
                          <input
                            type="text"
                            value={entry.site}
                            onChange={(e) =>
                              updateTimeEntry(day, "site", e.target.value)
                            }
                            className="max-w-[12rem] w-full border border-gray-300 rounded px-2 py-1 focus:outline-none focus:ring-2 focus:ring-blue-500"
                            placeholder="Inserisci note"
                          />
                        </td>
                        <td className="py-3 px-4 min-w-0">
                          <input
                            type="text"
                            value={entry.worksite}
                            onChange={(e) =>
                              updateTimeEntry(day, "worksite", e.target.value)
                            }
                            className="max-w-[10rem] w-full border border-gray-300 rounded px-2 py-1 focus:outline-none focus:ring-2 focus:ring-blue-500"
                            placeholder="Inserisci cantiere"
                          />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              </div>
            </div>
          </div>

          {/* Total Hours */}
          <div className="bg-gray-50 px-6 py-4 border-t border-gray-200">
            <div className="flex justify-between items-center">
              <span className="text-lg font-medium text-gray-700">
                Totale Ore:
              </span>
              <span className="text-2xl font-bold text-blue-600">
                {totalHours.toFixed(1)} ore
              </span>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="text-center mt-8 text-gray-500">
          <p>© 2024 Timesheet App - Gestisci le tue ore di lavoro</p>
        </div>
      </div>
    </div>
  );
}
