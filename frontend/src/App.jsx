import React, { useState, useEffect, useRef } from "react";
import axios from "axios";
import { 
  Upload, 
  FileSpreadsheet, 
  MessageSquare, 
  Send, 
  Play, 
  Code, 
  TrendingUp, 
  Database, 
  ChevronDown, 
  ChevronUp, 
  Terminal, 
  CheckCircle2, 
  AlertCircle,
  HelpCircle,
  Copy,
  Plus,
  ArrowRightLeft,
  X,
  Download,
  User
} from "lucide-react";
import {
  BarChart,
  Bar,
  LineChart,
  Line,
  PieChart,
  Cell,
  Pie,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer
} from "recharts";

const API_BASE = import.meta.env.VITE_API_BASE_URL || "http://localhost:8000";
const CHART_COLORS = ["#6366f1", "#06b6d4", "#10b981", "#f59e0b", "#ec4899", "#8b5cf6"];

export default function App() {
  // Dynamic list of dataset variables
  const [datasetKeys, setDatasetKeys] = useState(["df1", "df2"]);
  const [activeTab, setActiveTab] = useState("df1");

  // Dynamic dictionary of dataset states
  const [datasets, setDatasets] = useState({
    df1: { file: null, key: null, meta: null, preview: null },
    df2: { file: null, key: null, meta: null, preview: null }
  });

  const [isUploading, setIsUploading] = useState(false);
  const [uploadError, setUploadError] = useState(null);
  const [previewModalTarget, setPreviewModalTarget] = useState(null);

  // Chat State
  const [messages, setMessages] = useState([]);
  const [inputValue, setInputValue] = useState("");
  const [isGenerating, setIsGenerating] = useState(false);
  
  const [backendOnline, setBackendOnline] = useState(false);
  const [expandedLogs, setExpandedLogs] = useState({});
  const [customChartTypes, setCustomChartTypes] = useState({});
  const [schemaExpanded, setSchemaExpanded] = useState(true);
  const [showManual, setShowManual] = useState(false);
  const chatEndRef = useRef(null);

  // Check backend health on load
  useEffect(() => {
    axios.get(`${API_BASE}/`)
      .then(() => setBackendOnline(true))
      .catch(() => setBackendOnline(false));
  }, []);

  // Scroll to bottom of chat
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, isGenerating]);

  // Dynamically add a new dataset slot
  const addNewDatasetSlot = () => {
    const nextIndex = datasetKeys.length + 1;
    const newKey = `df${nextIndex}`;
    
    setDatasetKeys(prev => [...prev, newKey]);
    setDatasets(prev => ({
      ...prev,
      [newKey]: { file: null, key: null, meta: null, preview: null }
    }));
    setActiveTab(newKey);
    
    setMessages(prev => [...prev, {
      role: "assistant",
      content: `Added a new dataset file slot: **${newKey}**. You can now upload another table to query!`
    }]);
  };

  // Remove a dataset slot (only allowed if count > 1)
  const removeDatasetSlot = (keyToRemove, e) => {
    e.stopPropagation();
    if (datasetKeys.length <= 1) return;

    const updatedKeys = datasetKeys.filter(k => k !== keyToRemove);
    setDatasetKeys(updatedKeys);
    
    setDatasets(prev => {
      const updated = { ...prev };
      delete updated[keyToRemove];
      return updated;
    });

    if (activeTab === keyToRemove) {
      setActiveTab(updatedKeys[0]);
    }
  };

  // Handle Upload
  const handleFileUpload = async (selectedFile, target) => {
    if (!selectedFile) return;
    setUploadError(null);
    setIsUploading(true);

    const formData = new FormData();
    formData.append("file", selectedFile);

    try {
      const response = await axios.post(`${API_BASE}/upload`, formData, {
        headers: { "Content-Type": "multipart/form-data" }
      });
      
      const fileKey = response.data.file_key;
      const meta = {
        filename: response.data.filename,
        rows: response.data.rows,
        columnsCount: response.data.columns_count,
        columns: response.data.columns,
        dtypes: response.data.dtypes
      };

      // Load preview for this dataset
      const previewResponse = await axios.get(`${API_BASE}/preview?file_key=${fileKey}`);
      
      setDatasets(prev => {
        const updated = { ...prev };
        updated[target] = {
          file: selectedFile,
          key: fileKey,
          meta: meta,
          preview: previewResponse.data.sample
        };
        return updated;
      });

      setMessages(prev => [...prev, {
        role: "assistant",
        content: `Successfully loaded **${response.data.filename}** as **${target}** (${response.data.rows} rows). You can reference it in your questions as \`${target}\`.`,
        suggestedQuestions: generateSuggestions(target, response.data.columns)
      }]);
    } catch (err) {
      console.error(err);
      setUploadError(err.response?.data?.detail || "Failed to upload file. Check if it is a valid CSV/Excel sheet.");
    } finally {
      setIsUploading(false);
    }
  };

  // Generate Suggested Questions
  const generateSuggestions = (newTarget, columns) => {
    const suggestions = [];
    const activeFilesCount = Object.values(datasets).filter(d => d.key).length;

    if (activeFilesCount >= 2) {
      suggestions.push("Merge df1 and df2 on Region and show total sales by manager.");
      suggestions.push("Combine df1 and df2 to analyze department performance.");
    } else {
      const colsLower = columns.map(c => c.toLowerCase());
      if (colsLower.includes("sales") || colsLower.includes("revenue")) {
        suggestions.push("Which region had the highest sales?");
        suggestions.push("Show monthly revenue trends.");
      }
      if (colsLower.includes("salary")) {
        suggestions.push("Average salary department wise.");
      }
    }

    if (suggestions.length === 0) {
      suggestions.push("Show a summary of the columns.");
      suggestions.push("Give me the first 5 records.");
    }
    return suggestions.slice(0, 3);
  };

  // Handle Ask Submit
  const handleAsk = async (questionText) => {
    const query = (questionText || inputValue).trim();
    if (!query || isGenerating) return;

    // Collect active keys
    const fileKeysPayload = {};
    Object.keys(datasets).forEach(k => {
      if (datasets[k].key) {
        fileKeysPayload[k] = datasets[k].key;
      }
    });

    if (Object.keys(fileKeysPayload).length === 0) {
      setMessages(prev => [...prev, {
        role: "assistant",
        content: "Please upload at least one dataset before asking questions.",
        isError: true
      }]);
      return;
    }

    setInputValue("");
    setMessages(prev => [...prev, { role: "user", content: query }]);
    setIsGenerating(true);

    const apiHistory = messages.map(m => ({
      role: m.role,
      content: m.content
    }));

    try {
      const response = await axios.post(`${API_BASE}/ask`, {
        file_keys: fileKeysPayload,
        question: query,
        history: apiHistory
      });

      const data = response.data;
      if (data.success) {
        setMessages(prev => [...prev, {
          role: "assistant",
          content: data.answer,
          pandasCode: data.pandas_code,
          reasoning: data.reasoning,
          resultData: data.result_data,
          chart: data.chart,
          supportingDetails: data.supporting_details
        }]);
        if (data.data_modified) {
          refreshDatasets();
        }
      } else {
        setMessages(prev => [...prev, {
          role: "assistant",
          content: `Computation failed: **${data.error}**`,
          pandasCode: data.pandas_code,
          reasoning: data.reasoning,
          isError: true
        }]);
      }
    } catch (err) {
      console.error(err);
      setMessages(prev => [...prev, {
        role: "assistant",
        content: "Error communicating with the AI Agent server. Please confirm the backend is up.",
        isError: true
      }]);
    } finally {
      setIsGenerating(false);
    }
  };

  const toggleLog = (index) => {
    setExpandedLogs(prev => ({ ...prev, [index]: !prev[index] }));
  };

  const copyToClipboard = (text) => {
    navigator.clipboard.writeText(text);
  };

  const renderMessageContent = (content) => {
    if (!content) return null;
    // Regex splits on bold (**text**) and code (`text`) markers and line breaks
    const parts = content.split(/(\*\*.*?\*\*|`.*?`|\n)/g);
    return parts.map((part, idx) => {
      if (part.startsWith("**") && part.endsWith("**")) {
        return <strong key={idx} className="font-semibold text-white">{part.slice(2, -2)}</strong>;
      }
      if (part.startsWith("`") && part.endsWith("`")) {
        return <code key={idx} className="font-mono text-xs px-1.5 py-0.5 bg-[#1f2937]/80 border border-[#1f2937]/50 rounded text-indigo-300">{part.slice(1, -1)}</code>;
      }
      if (part === "\n") {
        return <br key={idx} />;
      }
      return <span key={idx}>{part}</span>;
    });
  };

  const refreshDatasets = async () => {
    Object.keys(datasets).forEach(async (target) => {
      const dataset = datasets[target];
      if (!dataset || !dataset.key) return;

      try {
        const previewResponse = await axios.get(`${API_BASE}/preview?file_key=${dataset.key}`);
        const refreshedMeta = {
          filename: dataset.meta.filename,
          rows: previewResponse.data.rows,
          columnsCount: previewResponse.data.columns_count,
          columns: previewResponse.data.columns,
          dtypes: previewResponse.data.dtypes
        };
        setDatasets(prev => {
          const updated = { ...prev };
          updated[target] = {
            ...updated[target],
            meta: refreshedMeta,
            preview: previewResponse.data.sample
          };
          return updated;
        });
      } catch (err) {
        console.error("Failed to refresh dataset context:", err);
      }
    });
  };

  const handleDownloadExcel = async (tabName) => {
    const dataset = datasets[tabName];
    if (!dataset || !dataset.key) return;
    try {
      window.open(`${API_BASE}/download?file_key=${encodeURIComponent(dataset.key)}`, "_blank");
    } catch (err) {
      console.error("Download failed:", err);
      alert("Failed to export Excel sheet.");
    }
  };

  const downloadCSV = (resultData, filename = "export.csv") => {
    if (!resultData || !resultData.data || !resultData.columns) return;
    const headers = resultData.columns.join(",");
    const rows = resultData.data.map(row => 
      resultData.columns.map(c => {
        const val = row[c] === null || row[c] === undefined ? "" : String(row[c]);
        return `"${val.replace(/"/g, '""')}"`;
      }).join(",")
    );
    const csvContent = [headers, ...rows].join("\n");
    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.setAttribute("download", filename);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const exportChartAsPNG = (chartId) => {
    const container = document.getElementById(chartId);
    const svgElement = container ? container.querySelector("svg") : null;
    if (!svgElement) return;

    // Get original responsive attributes so we can restore them
    const origWidth = svgElement.getAttribute("width");
    const origHeight = svgElement.getAttribute("height");
    const rect = container.getBoundingClientRect();

    // Temporarily force explicit dimensions on the live SVG for the image compiler
    svgElement.setAttribute("width", rect.width);
    svgElement.setAttribute("height", rect.height);

    // Inject temporary styles directly into the live SVG
    const styleElement = document.createElementNS("http://www.w3.org/2000/svg", "style");
    styleElement.setAttribute("id", "temp-export-style");
    styleElement.textContent = `
      text {
        font-family: 'DM Sans', system-ui, sans-serif !important;
        fill: #9ca3af !important;
        font-size: 11px !important;
      }
      .recharts-legend-item-text {
        fill: #d1d5db !important;
      }
      .recharts-cartesian-grid line {
        stroke: rgba(255,255,255,0.08) !important;
      }
    `;
    svgElement.insertBefore(styleElement, svgElement.firstChild);

    // Temporarily remove clip-path attributes and inline styles to prevent browser rendering bugs (exploding shapes)
    const clipPathStore = [];
    svgElement.querySelectorAll("*").forEach(el => {
      const attrVal = el.getAttribute("clip-path");
      const styleVal = el.style.clipPath;
      if (attrVal || styleVal) {
        clipPathStore.push({ el, attrVal, styleVal });
        el.removeAttribute("clip-path");
        el.style.clipPath = "none";
      }
    });

    // Serialize live SVG element
    const svgString = new XMLSerializer().serializeToString(svgElement);

    // Immediately restore original responsive attributes, clip-paths, and remove temp styles
    if (origWidth) svgElement.setAttribute("width", origWidth);
    else svgElement.removeAttribute("width");
    if (origHeight) svgElement.setAttribute("height", origHeight);
    else svgElement.removeAttribute("height");
    
    clipPathStore.forEach(({ el, attrVal, styleVal }) => {
      if (attrVal) el.setAttribute("clip-path", attrVal);
      if (styleVal) el.style.clipPath = styleVal;
    });
    
    const tempStyle = svgElement.querySelector("#temp-export-style");
    if (tempStyle) tempStyle.remove();

    // Compile SVG to Base64 Data URI (bypasses browser security locks on Blob URLs in canvas)
    let svgBlob;
    try {
      const base64 = window.btoa(unescape(encodeURIComponent(svgString)));
      svgBlob = "data:image/svg+xml;base64," + base64;
    } catch (e) {
      console.error("Base64 serialization failed, falling back to URL object", e);
      const blob = new Blob([svgString], { type: "image/svg+xml;charset=utf-8" });
      svgBlob = (window.URL || window.webkitURL).createObjectURL(blob);
    }
    
    const image = new Image();
    image.onerror = (err) => {
      console.error("Failed to compile SVG image:", err);
    };
    
    image.onload = () => {
      const canvas = document.createElement("canvas");
      // Use 2x scaling for high-resolution Retina output
      const scale = 2;
      canvas.width = rect.width * scale;
      canvas.height = rect.height * scale;
      const context = canvas.getContext("2d");
      
      // Fill canvas background
      context.fillStyle = "#111827"; 
      context.fillRect(0, 0, canvas.width, canvas.height);
      
      // Draw image
      context.scale(scale, scale);
      context.drawImage(image, 0, 0);
      
      try {
        const png = canvas.toDataURL("image/png");
        const downloadLink = document.createElement("a");
        downloadLink.href = png;
        downloadLink.download = "chart.png";
        document.body.appendChild(downloadLink);
        downloadLink.click();
        document.body.removeChild(downloadLink);
      } catch (err) {
        console.error("Canvas export failed:", err);
      }
      
      if (svgBlob.startsWith("blob:")) {
        (window.URL || window.webkitURL).revokeObjectURL(svgBlob);
      }
    };
    image.src = svgBlob;
  };

  const exportChartAsSVG = (chartId) => {
    const container = document.getElementById(chartId);
    const svgElement = container ? container.querySelector("svg") : null;
    if (!svgElement) return;

    const rect = container.getBoundingClientRect();
    const origWidth = svgElement.getAttribute("width");
    const origHeight = svgElement.getAttribute("height");

    // Force explicit dimensions for standalone preview
    svgElement.setAttribute("width", rect.width);
    svgElement.setAttribute("height", rect.height);

    const styleElement = document.createElementNS("http://www.w3.org/2000/svg", "style");
    styleElement.setAttribute("id", "temp-export-style");
    styleElement.textContent = `
      text {
        font-family: 'DM Sans', system-ui, sans-serif !important;
        fill: #9ca3af !important;
        font-size: 11px !important;
      }
      .recharts-legend-item-text {
        fill: #d1d5db !important;
      }
      .recharts-cartesian-grid line {
        stroke: rgba(255,255,255,0.08) !important;
      }
    `;
    svgElement.insertBefore(styleElement, svgElement.firstChild);

    // Temporarily remove clip-path attributes and inline styles to prevent browser rendering bugs (exploding shapes)
    const clipPathStore = [];
    svgElement.querySelectorAll("*").forEach(el => {
      const attrVal = el.getAttribute("clip-path");
      const styleVal = el.style.clipPath;
      if (attrVal || styleVal) {
        clipPathStore.push({ el, attrVal, styleVal });
        el.removeAttribute("clip-path");
        el.style.clipPath = "none";
      }
    });

    const svgString = new XMLSerializer().serializeToString(svgElement);

    // Restore attributes and clip-paths
    if (origWidth) svgElement.setAttribute("width", origWidth);
    else svgElement.removeAttribute("width");
    if (origHeight) svgElement.setAttribute("height", origHeight);
    else svgElement.removeAttribute("height");
    
    clipPathStore.forEach(({ el, attrVal, styleVal }) => {
      if (attrVal) el.setAttribute("clip-path", attrVal);
      if (styleVal) el.style.clipPath = styleVal;
    });
    
    const tempStyle = svgElement.querySelector("#temp-export-style");
    if (tempStyle) tempStyle.remove();

    const blob = new Blob([svgString], { type: "image/svg+xml;charset=utf-8" });
    const URLObject = window.URL || window.webkitURL || window;
    const blobURL = URLObject.createObjectURL(blob);

    const downloadLink = document.createElement("a");
    downloadLink.href = blobURL;
    downloadLink.download = "chart.svg";
    document.body.appendChild(downloadLink);
    downloadLink.click();
    document.body.removeChild(downloadLink);
    URLObject.revokeObjectURL(blobURL);
  };

  const clearDataset = (target) => {
    setDatasets(prev => {
      const updated = { ...prev };
      updated[target] = { file: null, key: null, meta: null, preview: null };
      return updated;
    });
  };

  const activeDataset = datasets[activeTab];

  return (
    <div className="flex flex-col h-screen overflow-hidden bg-[#0b0f19] text-[#f3f4f6]">
      {/* Header */}
      <header className="flex items-center justify-between px-6 py-2 bg-gradient-to-r from-blue-900/30 via-purple-900/30 to-orange-700/20 backdrop-blur-md border-b border-[#1f2937]/50 sticky top-0 z-10">
        <div className="flex items-center gap-3">
          <div className="p-1.5 rounded-lg bg-indigo-600/10 border border-indigo-500/30">
            <Database className="w-5 h-5 text-indigo-400" />
          </div>
          <div>
            <h1 className="text-base font-extrabold tracking-tight bg-clip-text text-transparent bg-gradient-to-r from-blue-400 via-purple-400 to-orange-400 m-0 font-sans">CSV / Data Q&A Agent</h1>
            <p className="text-[10px] text-gray-400 font-sans">Dynamic AST-Safe Analytical Reasoner</p>
          </div>
        </div>
        <div className="flex items-center gap-4">
          <button
            onClick={() => setShowManual(true)}
            className="text-gray-400 hover:text-indigo-400 p-1.5 rounded-lg hover:bg-[#1f2937]/50 transition-all cursor-pointer flex items-center gap-1.5 text-xs font-semibold font-sans border border-transparent hover:border-[#1f2937]/60"
            title="User Manual"
          >
            <HelpCircle className="w-4 h-4" />
            <span>Manual</span>
          </button>
        </div>
      </header>

      {/* Main Grid */}
      <main className="flex-1 grid grid-cols-1 lg:grid-cols-12 gap-6 p-4 max-w-[1600px] w-full mx-auto overflow-hidden min-h-0">
        
        {/* Left Panel: Uploads and Schemas */}
        <section className="lg:col-span-3 flex flex-col h-[calc(100vh-90px)] overflow-y-auto pr-1.5 gap-6">
          
          {/* Tab Selector & Add Button */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-xs text-gray-400 font-semibold uppercase tracking-wider font-sans">Active Files</span>
              <button
                onClick={addNewDatasetSlot}
                className="text-xs bg-indigo-600/20 border border-indigo-500/30 text-indigo-300 hover:bg-indigo-600/30 font-semibold px-2 py-1 rounded flex items-center gap-1 transition-all cursor-pointer font-sans"
              >
                <Plus className="w-3.5 h-3.5" /> Add File
              </button>
            </div>
            <div className="flex flex-wrap gap-1.5 p-1 bg-[#111827]/40 border border-[#1f2937]/60 rounded-lg max-h-32 overflow-y-auto">
              {datasetKeys.map((key) => (
                <button
                  key={key}
                  onClick={() => setActiveTab(key)}
                  className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-md transition-all cursor-pointer ${activeTab === key ? "bg-indigo-600 text-white" : "text-gray-400 hover:text-white"}`}
                >
                  <span>{key} {datasets[key]?.key && "✓"}</span>
                  {datasetKeys.length > 1 && (
                    <X
                      className="w-3 h-3 text-gray-400 hover:text-rose-400 shrink-0"
                      onClick={(e) => removeDatasetSlot(key, e)}
                    />
                  )}
                </button>
              ))}
            </div>
          </div>

          {/* Upload card */}
          <div className="bg-[#111827]/50 border border-[#1f2937]/50 rounded-xl p-5 backdrop-blur-sm">
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-sm font-semibold uppercase tracking-wider text-gray-400 flex items-center gap-2">
                <Upload className="w-4 h-4 text-indigo-400" /> Upload to {activeTab}
              </h2>
              {activeDataset?.key && (
                <button 
                  onClick={() => clearDataset(activeTab)}
                  className="text-xs text-rose-400 hover:text-rose-300 font-semibold cursor-pointer"
                >
                  Clear File
                </button>
              )}
            </div>

            <label className={`border-2 border-dashed ${activeDataset?.file ? "border-emerald-500/50 bg-emerald-500/5" : "border-[#1f2937] hover:border-indigo-500/50 bg-[#1f2937]/10"} rounded-xl py-3.5 px-4 flex flex-col items-center justify-center cursor-pointer transition-all`}>
              <input 
                type="file" 
                className="hidden" 
                accept=".csv, .xlsx, .xls"
                onChange={(e) => handleFileUpload(e.target.files[0], activeTab)}
                disabled={isUploading}
              />
              <FileSpreadsheet className={`w-7 h-7 mb-1.5 ${activeDataset?.file ? "text-emerald-400" : "text-gray-500"}`} />
              <p className="text-xs font-medium text-gray-300 text-center truncate max-w-full px-2">
                {activeDataset?.file ? activeDataset.file.name : "Drag & Drop or Click to browse"}
              </p>
              <p className="text-[10px] text-gray-500 mt-0.5">Assigns as variable '{activeTab}'</p>
            </label>

            {isUploading && (
              <div className="mt-4 flex items-center justify-center gap-2 text-sm text-indigo-400">
                <span className="w-4 h-4 border-2 border-indigo-400 border-t-transparent rounded-full animate-spin"></span>
                Processing table context...
              </div>
            )}

            {uploadError && (
              <div className="mt-4 p-3 rounded-lg bg-rose-500/10 border border-rose-500/20 text-xs text-rose-400 flex items-start gap-2">
                <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                <span>{uploadError}</span>
              </div>
            )}
          </div>

          {/* Active Schema Panel */}
          {activeDataset?.meta && (
            <div className="bg-[#111827]/50 border border-[#1f2937]/50 rounded-xl p-5 backdrop-blur-sm flex-1 flex flex-col min-h-[300px]">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-sm font-semibold uppercase tracking-wider text-gray-400 flex items-center gap-2">
                  <Database className="w-4 h-4 text-indigo-400" /> {activeTab} Schema
                </h2>
                <div className="flex items-center gap-3">
                  <button 
                    onClick={() => handleDownloadExcel(activeTab)}
                    className="text-xs text-emerald-400 hover:text-emerald-300 font-semibold flex items-center gap-1.5 cursor-pointer transition-colors font-sans"
                    title="Download active cleaned dataset as Excel sheet"
                  >
                    <Download className="w-3.5 h-3.5" /> Excel
                  </button>
                  <button 
                    onClick={() => setPreviewModalTarget(activeTab)}
                    className="text-xs text-indigo-400 hover:text-indigo-300 font-medium underline cursor-pointer font-sans"
                  >
                    Raw Preview
                  </button>
                </div>
              </div>

              {/* Quick stats grid */}
              <div className="grid grid-cols-2 gap-3 mb-4">
                <div className="p-3 bg-[#111827]/80 rounded-lg border border-[#1f2937]/40">
                  <span className="text-xs text-gray-400 block mb-1 font-sans">Row Count</span>
                  <span className="text-lg font-bold text-white font-mono">{activeDataset.meta.rows.toLocaleString()}</span>
                </div>
                <div className="p-3 bg-[#111827]/80 rounded-lg border border-[#1f2937]/40">
                  <span className="text-xs text-gray-400 block mb-1 font-sans">Columns</span>
                  <span className="text-lg font-bold text-white font-mono">{activeDataset.meta.columnsCount}</span>
                </div>
              </div>

              {/* Collapsible Columns & Types Dropdown */}
              <button 
                onClick={() => setSchemaExpanded(!schemaExpanded)}
                className="w-full flex items-center justify-between text-xs text-gray-400 uppercase tracking-wider font-semibold mb-2 py-1.5 hover:text-white transition-colors cursor-pointer font-sans"
              >
                <span>Columns & Types</span>
                {schemaExpanded ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
              </button>
              
              {schemaExpanded && (
                <div className="flex-1 overflow-y-auto max-h-[320px] pr-2 space-y-1.5 border border-[#1f2937]/30 rounded-lg p-2 bg-[#111827]/40">
                  {activeDataset.meta.columns.map((col, idx) => (
                    <div key={idx} className="flex justify-between items-center py-1.5 px-2 bg-[#1f2937]/25 rounded border border-transparent hover:border-[#1f2937] transition-all">
                      <span className="text-sm text-gray-200 font-medium truncate max-w-[180px] font-sans">{col}</span>
                      <span className="text-[10px] text-indigo-300 font-mono bg-indigo-950/40 border border-indigo-900/40 px-2 py-0.5 rounded">
                        {activeDataset.meta.dtypes[col]}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {!activeDataset?.meta && (
            <div className="flex-1 border border-dashed border-[#1f2937] rounded-xl flex flex-col items-center justify-center p-8 text-center text-gray-500">
              <Database className="w-8 h-8 mb-2 stroke-1" />
              <p className="text-sm font-sans">No file uploaded for {activeTab}</p>
              <p className="text-xs mt-1 max-w-[200px] font-sans">Click upload to assign a dataset to the variable '{activeTab}'</p>
            </div>
          )}
        </section>

        {/* Right Panel: Chat interface */}
        <section className="lg:col-span-9 flex flex-col h-[calc(100vh-90px)] border border-[#1f2937]/50 rounded-xl bg-[#111827]/30 overflow-hidden backdrop-blur-sm">
          {/* Scrollable Conversation */}
          <div className="flex-1 overflow-y-auto p-6 space-y-6">
            {messages.length === 0 ? (
              <div className="h-full flex flex-col items-center justify-center text-center p-8 text-gray-500">
                <MessageSquare className="w-12 h-12 mb-3 stroke-1 text-indigo-500/50" />
                <h3 className="text-xl font-extrabold tracking-tight bg-clip-text text-transparent bg-gradient-to-r from-blue-400 via-purple-400 to-orange-400 mb-1.5 font-sans">CSV / Data Q&A Agent</h3>
                <p className="text-sm max-w-[450px] font-sans">
                  Upload your spreadsheets (e.g. **df1**, **df2**) and perform your analysis
                </p>
              </div>
            ) : (
              messages.map((msg, index) => (
                <div key={index} className={`flex gap-3 ${msg.role === "user" ? "justify-end" : "justify-start"}`}>
                  
                  {msg.role !== "user" && (
                    <div className="w-8 h-8 rounded-full bg-gradient-to-tr from-blue-600 via-indigo-600 to-purple-500 flex items-center justify-center text-white shrink-0 text-[10px] font-bold uppercase shadow-md shadow-indigo-500/10">
                      AI
                    </div>
                  )}

                  <div className={`max-w-[85%] space-y-4 ${msg.role === "user" ? "bg-indigo-600 text-white rounded-2xl rounded-tr-none px-4 py-3 shadow-md" : ""}`}>
                    
                    {msg.role === "user" && (
                      <p className="text-sm leading-relaxed font-sans">{renderMessageContent(msg.content)}</p>
                    )}

                    {msg.role !== "user" && (
                      <div className="space-y-4 text-gray-200">
                        {/* Summary Answer */}
                        <div className="text-sm leading-relaxed whitespace-pre-line prose prose-invert font-sans">
                          {renderMessageContent(msg.content)}
                        </div>

                        {/* Chart Area */}
                        {msg.chart && (
                          <div className="bg-[#111827]/80 border border-[#1f2937]/60 rounded-xl p-4">
                            <div className="flex items-center justify-between mb-3 border-b border-[#1f2937]/40 pb-2">
                              <h4 className="text-xs font-semibold text-indigo-400 uppercase tracking-wider flex items-center gap-1.5">
                                <TrendingUp className="w-3.5 h-3.5" /> Result Chart
                              </h4>
                              <div className="flex items-center gap-2">
                                {/* Option A: Manual Chart Toggle buttons */}
                                <div className="flex bg-[#1f2937]/40 border border-[#1f2937] rounded p-0.5 text-[10px]">
                                  {["bar", "line", "pie"].map((type) => (
                                    <button
                                      key={type}
                                      onClick={() => setCustomChartTypes(prev => ({ ...prev, [index]: type }))}
                                      className={`px-2 py-0.5 rounded capitalize font-sans transition-all cursor-pointer ${
                                        (customChartTypes[index] || msg.chart.type) === type
                                          ? "bg-indigo-600 text-white font-medium"
                                          : "text-gray-400 hover:text-white"
                                      }`}
                                    >
                                      {type}
                                    </button>
                                  ))}
                                </div>
                              </div>
                            </div>
                            <div className="h-64 w-full" id={`chart-container-${index}`}>
                              <ResponsiveContainer width="100%" height="100%">
                                {(customChartTypes[index] || msg.chart.type) === "bar" ? (
                                  <BarChart data={msg.chart.data} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
                                    <XAxis dataKey={msg.chart.xAxisKey} stroke="#9ca3af" fontSize={11} tickLine={false} />
                                    <YAxis stroke="#9ca3af" fontSize={11} tickLine={false} />
                                    <Tooltip contentStyle={{ backgroundColor: "#1f2937", border: "1px solid #374151" }} />
                                    <Legend wrapperStyle={{ fontSize: 11 }} />
                                    {msg.chart.dataKeys.map((key, i) => (
                                      <Bar key={key} dataKey={key} fill={CHART_COLORS[i % CHART_COLORS.length]} radius={[4, 4, 0, 0]} />
                                    ))}
                                  </BarChart>
                                ) : (customChartTypes[index] || msg.chart.type) === "line" ? (
                                  <LineChart data={msg.chart.data} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
                                    <XAxis dataKey={msg.chart.xAxisKey} stroke="#9ca3af" fontSize={11} tickLine={false} />
                                    <YAxis stroke="#9ca3af" fontSize={11} tickLine={false} />
                                    <Tooltip contentStyle={{ backgroundColor: "#1f2937", border: "1px solid #374151" }} />
                                    <Legend wrapperStyle={{ fontSize: 11 }} />
                                    {msg.chart.dataKeys.map((key, i) => (
                                      <Line key={key} type="monotone" dataKey={key} stroke={CHART_COLORS[i % CHART_COLORS.length]} strokeWidth={2} dot={{ r: 4 }} activeDot={{ r: 6 }} />
                                    ))}
                                  </LineChart>
                                ) : (
                                  <PieChart>
                                    <Pie
                                      data={msg.chart.data}
                                      dataKey={msg.chart.dataKeys[0]}
                                      nameKey={msg.chart.xAxisKey}
                                      cx="50%"
                                      cy="50%"
                                      outerRadius={80}
                                      fill="#8884d8"
                                      label={({ name, percent }) => `${name} (${(percent * 100).toFixed(0)}%)`}
                                      labelLine={false}
                                    >
                                      {msg.chart.data.map((entry, idx) => (
                                        <Cell key={`cell-${idx}`} fill={CHART_COLORS[idx % CHART_COLORS.length]} />
                                      ))}
                                    </Pie>
                                    <Tooltip contentStyle={{ backgroundColor: "#1f2937", border: "1px solid #374151" }} />
                                    <Legend wrapperStyle={{ fontSize: 11 }} />
                                  </PieChart>
                                )}
                              </ResponsiveContainer>
                            </div>
                          </div>
                        )}

                        {/* Result Table Data */}
                        {msg.resultData && (msg.resultData.type === "dataframe" || msg.resultData.type === "series") && (
                          <div className="bg-[#111827]/80 border border-[#1f2937]/60 rounded-xl overflow-hidden max-w-full">
                            <div className="flex items-center justify-between px-3 py-2 bg-[#1f2937]/40 border-b border-[#1f2937]">
                              <span className="text-[10px] text-indigo-400 font-semibold uppercase tracking-wider font-sans">Supporting Table</span>
                              {/* Option B: Export Table button */}
                              <button
                                onClick={() => downloadCSV(msg.resultData, `table-result-${index}.csv`)}
                                className="text-[10px] bg-indigo-950/40 border border-indigo-900/60 hover:bg-indigo-950 text-indigo-300 px-2.5 py-1 rounded flex items-center gap-1.5 cursor-pointer transition-all font-sans"
                              >
                                <Download className="w-3.5 h-3.5" /> CSV
                              </button>
                            </div>
                            <div className="overflow-x-auto max-h-60">
                              <table className="w-full text-left border-collapse text-xs font-sans">
                                <thead>
                                  <tr className="bg-[#1f2937]/20 border-b border-[#1f2937]/40">
                                    {msg.resultData.columns.map((c, idx) => (
                                      <th key={idx} className="p-2.5 font-semibold text-indigo-300 font-mono">{c}</th>
                                    ))}
                                  </tr>
                                </thead>
                                <tbody>
                                  {msg.resultData.data.map((row, idx) => (
                                    <tr key={idx} className="border-b border-[#1f2937]/30 hover:bg-white/5 transition-colors">
                                      {msg.resultData.columns.map((c, cIdx) => (
                                        <td key={cIdx} className="p-2.5 text-gray-300">{row[c]}</td>
                                      ))}
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            </div>
                          </div>
                        )}

                        {/* Scalar display */}
                        {msg.resultData && msg.resultData.type === "scalar" && (
                          <div className="py-2.5 px-4 bg-[#111827]/80 border border-[#1f2937]/60 rounded-lg inline-flex items-center gap-2 text-sm font-mono text-emerald-400">
                            <CheckCircle2 className="w-4 h-4" /> Result: {msg.resultData.value}
                          </div>
                        )}

                        {/* Follow up suggestions */}
                        {msg.suggestedQuestions && msg.suggestedQuestions.length > 0 && (
                          <div className="pt-2">
                            <span className="text-[11px] text-gray-500 font-semibold uppercase tracking-wider block mb-2 font-sans">Try asking:</span>
                            <div className="flex flex-wrap gap-2">
                              {msg.suggestedQuestions.map((q, qidx) => (
                                <button
                                  key={qidx}
                                  onClick={() => handleAsk(q)}
                                  className="group text-xs text-indigo-300 hover:text-white bg-gradient-to-r from-[#111827]/40 via-indigo-600/60 to-purple-600/70 bg-[length:200%_100%] bg-left hover:bg-right border border-[#1f2937]/80 hover:border-transparent rounded-full px-3.5 py-1.5 font-medium transition-all duration-500 ease-out text-left flex items-center gap-1.5 cursor-pointer font-sans"
                                >
                                  <Plus className="w-3.5 h-3.5 shrink-0 text-indigo-400 group-hover:text-white transition-colors" /> {q}
                                </button>
                              ))}
                            </div>
                          </div>
                        )}

                        {/* Collapsible execution log code */}
                        {(msg.pandasCode || msg.reasoning) && (
                          <div className="border border-[#1f2937]/40 rounded-lg overflow-hidden bg-[#1f2937]/10">
                            <button
                              onClick={() => toggleLog(index)}
                              className="w-full flex items-center justify-between px-3 py-2 text-xs font-semibold text-gray-400 hover:bg-[#1f2937]/20 transition-all font-mono"
                            >
                              <span className="flex items-center gap-1.5">
                                <Terminal className="w-3.5 h-3.5 text-indigo-400" /> 
                                {msg.isError ? "View Error logs" : "Calculation Logs"}
                              </span>
                              {expandedLogs[index] ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                            </button>
                            {expandedLogs[index] && (
                              <div className="p-3 border-t border-[#1f2937]/35 bg-black/35 font-mono text-xs space-y-3">
                                {msg.reasoning && (
                                  <div>
                                    <span className="text-[10px] text-indigo-400 font-semibold block mb-1">Reasoning strategy:</span>
                                    <p className="text-gray-400 leading-relaxed">{msg.reasoning}</p>
                                  </div>
                                )}
                                {msg.pandasCode && (
                                  <div>
                                    <div className="flex items-center justify-between mb-1">
                                      <span className="text-[10px] text-emerald-400 font-semibold">AST pandas execution chain:</span>
                                      <button 
                                        onClick={() => copyToClipboard(msg.pandasCode)}
                                        className="text-[10px] text-gray-400 hover:text-white flex items-center gap-1 cursor-pointer"
                                      >
                                        <Copy className="w-3 h-3" /> Copy
                                      </button>
                                    </div>
                                    <pre className="p-2.5 rounded bg-black/50 border border-gray-800 text-emerald-300 font-mono text-[11px] overflow-x-auto">
                                      {msg.pandasCode}
                                    </pre>
                                  </div>
                                )}
                              </div>
                            )}
                          </div>
                        )}

                      </div>
                    )}
                  </div>
                </div>
              ))
            )}

            {isGenerating && (
              <div className="flex gap-3">
                <div className="w-8 h-8 rounded-full bg-gradient-to-tr from-blue-600 via-indigo-600 to-purple-500 flex items-center justify-center text-white shrink-0 text-[10px] font-bold uppercase animate-pulse shadow-md shadow-indigo-500/10">
                  AI
                </div>
                <div className="bg-[#1f2937]/10 border border-[#1f2937]/40 rounded-xl p-4 text-xs font-mono text-gray-400 flex items-center gap-2">
                  <span className="w-3 h-3 border-2 border-indigo-400 border-t-transparent rounded-full animate-spin"></span>
                  Agent is calculating multi-table pandas operations...
                </div>
              </div>
            )}

            <div ref={chatEndRef} />
          </div>

          {/* Bottom input area */}
          <div className="p-4 bg-[#111827]/60 border-t border-[#1f2937]/50">
            <form
              onSubmit={(e) => {
                e.preventDefault();
                handleAsk();
              }}
              className="relative flex items-center"
            >
              <input
                type="text"
                value={inputValue}
                onChange={(e) => setInputValue(e.target.value)}
                placeholder={datasets.df1.key ? "Ask about df1/df2/df3 (e.g., Merge df1 and df2 on Region and list managers)" : "Upload df1 first to ask questions"}
                disabled={!datasets.df1.key || isGenerating}
                className="w-full bg-[#111827] border border-[#1f2937] focus:border-indigo-500/60 rounded-xl py-3.5 pl-4 pr-14 text-sm text-gray-100 placeholder-gray-500 focus:outline-none focus:ring-1 focus:ring-indigo-500/40 transition-all font-sans"
              />
              <button
                type="submit"
                disabled={!datasets.df1.key || !inputValue.trim() || isGenerating}
                className="absolute right-2 px-3.5 py-2 bg-indigo-600 disabled:bg-gray-800 text-white disabled:text-gray-600 rounded-lg hover:bg-indigo-500 transition-all flex items-center gap-1 cursor-pointer"
              >
                <Send className="w-4 h-4" />
              </button>
            </form>
          </div>
        </section>
      </main>

      {/* Raw Preview Modal */}
      {previewModalTarget && datasets[previewModalTarget]?.meta && datasets[previewModalTarget]?.preview && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-6 bg-black/70 backdrop-blur-sm">
          <div className="bg-[#111827] border border-[#1f2937] w-full max-w-5xl rounded-2xl overflow-hidden shadow-2xl flex flex-col max-h-[85vh]">
            <div className="px-6 py-4 border-b border-[#1f2937] flex items-center justify-between">
              <div>
                <h3 className="font-bold text-white flex items-center gap-2 font-sans">
                  <Database className="w-5 h-5 text-indigo-400" /> Dataset Raw Preview ({previewModalTarget})
                </h3>
                <p className="text-xs text-gray-400 mt-0.5 font-sans">
                  {datasets[previewModalTarget].meta.filename} (Showing first 10 rows)
                </p>
              </div>
              <button
                onClick={() => setPreviewModalTarget(null)}
                className="text-xs bg-[#1f2937] hover:bg-[#374151] text-gray-300 font-semibold px-3 py-1.5 rounded-lg cursor-pointer font-sans"
              >
                Close
              </button>
            </div>
            <div className="flex-1 overflow-auto p-6">
              <table className="w-full text-left border-collapse text-xs font-sans">
                <thead>
                  <tr className="bg-[#1f2937] border-b border-[#1f2937]">
                    {datasets[previewModalTarget].meta.columns.map((c, idx) => (
                      <th key={idx} className="p-3 font-semibold text-indigo-300 font-mono sticky top-0 bg-[#111827]">{c}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {datasets[previewModalTarget].preview.map((row, idx) => (
                    <tr key={idx} className="border-b border-[#1f2937]/35 hover:bg-white/5 transition-colors">
                      {datasets[previewModalTarget].meta.columns.map((c, cIdx) => (
                        <td key={cIdx} className="p-3 text-gray-300">{row[c]}</td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* User Manual Modal */}
      {showManual && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-6 bg-black/70 backdrop-blur-sm">
          <div className="bg-[#111827] border border-[#1f2937] w-full max-w-2xl rounded-2xl overflow-hidden shadow-2xl flex flex-col max-h-[85vh]">
            <div className="px-6 py-4 border-b border-[#1f2937] flex items-center justify-between">
              <h3 className="font-bold text-white flex items-center gap-2 font-sans">
                <HelpCircle className="w-5 h-5 text-indigo-400" /> User Manual & Capabilities
              </h3>
              <button
                onClick={() => setShowManual(false)}
                className="text-xs bg-[#1f2937] hover:bg-[#374151] text-gray-300 font-semibold px-3 py-1.5 rounded-lg cursor-pointer font-sans"
              >
                Close
              </button>
            </div>
            <div className="p-6 overflow-y-auto space-y-5 text-sm text-gray-300 leading-relaxed font-sans">
              <div>
                <h4 className="font-bold text-indigo-300 mb-1.5">1. Loading Datasets</h4>
                <p>Upload CSV or Excel files into slot tabs (e.g. <strong>df1</strong>, <strong>df2</strong>). Each active tab assigns that dataset to a variable that you can reference directly in your queries.</p>
              </div>
              <div>
                <h4 className="font-bold text-indigo-300 mb-1.5">2. Natural Language Analytics</h4>
                <p>Ask plain-English questions about your data (e.g., <em>"Which product generated the highest revenue?"</em> or <em>"Show monthly units sold trends"</em>). The agent translates it into safe python operations and returns formatted results.</p>
              </div>
              <div>
                <h4 className="font-bold text-indigo-300 mb-1.5">3. Natural Language Data Cleaning</h4>
                <p>Modify datasets in-place by issuing commands like <em>"Drop column cost"</em> or <em>"Fill missing values in profit with 0"</em>. The modifications persist, reload the active preview, and update all subsequent queries immediately.</p>
              </div>
              <div>
                <h4 className="font-bold text-indigo-300 mb-1.5">4. Multi-Table Merges & Joins</h4>
                <p>Combine multiple datasets by asking questions like <em>"Merge df1 and df2 on Region and list total sales by store manager."</em></p>
              </div>
              <div>
                <h4 className="font-bold text-indigo-300 mb-1.5">5. Exports & Downloads</h4>
                <p>Download your computed answers as a CSV file, or download the entire active, cleaned dataset as a formatted Excel spreadsheet using the <strong>Excel</strong> link next to the raw preview.</p>
              </div>
              <div>
                <h4 className="font-bold text-indigo-300 mb-1.5">6. SQL-Equivalent Capabilities</h4>
                <ul className="list-disc pl-5 space-y-1 text-xs">
                  <li><strong>SELECT / WHERE (Filtering)</strong>: Filter rows and pick columns (e.g. <em>"Show rows where revenue &gt; 50,000"</em>).</li>
                  <li><strong>GROUP BY (Aggregations)</strong>: Performs grouping and applies functions like <code>SUM</code>, <code>AVG/MEAN</code>, <code>MEDIAN</code>, <code>MIN</code>, <code>MAX</code>, and <code>COUNT</code>.</li>
                  <li><strong>ORDER BY (Sorting)</strong>: Sorts rows ascending/descending (e.g. <em>"Sort products by units sold ascending"</em>).</li>
                  <li><strong>JOIN / MERGE (Relations)</strong>: Merges multiple datasets on matching keys (e.g. <em>"Merge df1 and df2 on Region"</em>).</li>
                  <li><strong>LIMIT</strong>: Restricts row outputs (e.g. <em>"Show top 5 rows"</em>).</li>
                  <li><strong>LIKE / Pattern Matching</strong>: Searches text columns (e.g. <em>"Show rows where product contains 'Elite'"</em>).</li>
                </ul>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
