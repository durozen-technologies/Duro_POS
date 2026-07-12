import { BillRead, BillStatus, type RetailerSaleRead, type RetailerSaleReceiptRead } from "@/types/api";
import { getLocalizedItemName } from "@/hooks/use-shop-translation";
import { ShopLanguage } from "@/store/shop-language-store";
import { formatCurrency, formatDateTime, formatUnit } from "@/utils/format";

function formatReceiptCurrency(value?: string | number | null) {
  return formatCurrency(value).replace(/^Rs\.\s*/, "");
}

const RECEIPT_COPY = {
  en: {
    receipt: "Receipt",
    bill: "Bill No",
    date: "Date",
    items: "ITEMS",
    item: "ITEM",
    quantityUnit: "QTY/UNIT",
    total: "TOTAL",
    rate: "Rate",
    cash: "Cash",
    upi: "UPI",
    thankYou: "Thank you. Visit again.",
    poweredBy: "Software provided by",
    provider: "Durozen Technologies pvt. Ltd.",
  },
  ta: {
    receipt: "ரசீது",
    bill: "பில் எண்",
    date: "தேதி",
    items: "பொருட்கள்",
    item: "பொருள்",
    quantityUnit: "அளவு",
    total: "மொத்தம்",
    rate: "விலை",
    cash: "பணம்",
    upi: "யூபிஐ",
    thankYou: "நன்றி. மீண்டும் வருக.",
    poweredBy: "மென்பொருள் வழங்கியது",
    provider: "Durozen Technologies pvt. Ltd.",
  },
} as const;

const RECEIPT_LANGUAGE: ShopLanguage = "ta";

function getReceiptLanguage(language: ShopLanguage | undefined = undefined) {
  return language ?? RECEIPT_LANGUAGE;
}

function getReceiptCopy(language?: ShopLanguage) {
  const resolvedLanguage = getReceiptLanguage(language);
  return RECEIPT_COPY[resolvedLanguage];
}

function formatReceiptShopName(shopName: string, language?: ShopLanguage) {
  return getReceiptLanguage(language) === "ta" ? shopName : shopName.toUpperCase();
}

function formatReceiptOrganizationName(organizationName: string, language?: ShopLanguage) {
  return getReceiptLanguage(language) === "ta" ? organizationName : organizationName.toUpperCase();
}

export const RECEIPT_EXPORT_WEBVIEW_SCRIPT =
  "window.__EXPORT_RECEIPT_IMAGE__ && window.__EXPORT_RECEIPT_IMAGE__(); true;";

export const RECEIPT_SHARE_EXPORT_WEBVIEW_SCRIPT =
  "window.__EXPORT_RECEIPT_SHARE_IMAGE__ && window.__EXPORT_RECEIPT_SHARE_IMAGE__(); true;";

function buildReceiptImageExportScript() {
  return `
        <script>
          (function () {
            function postMessage(payload) {
              if (!window.ReactNativeWebView || typeof window.ReactNativeWebView.postMessage !== "function") {
                return;
              }

              window.ReactNativeWebView.postMessage(JSON.stringify(payload));
            }

            async function waitForFonts() {
              if (!document.fonts || !document.fonts.ready) {
                return;
              }

              try {
                await document.fonts.ready;
              } catch {
                // Continue with system fallback fonts when the browser cannot fully resolve font readiness.
              }
            }

            function loadReceiptExportPayload() {
              var payloadNode = document.getElementById("receipt-export-data");
              if (!payloadNode || !payloadNode.textContent) {
                throw new Error("Receipt export payload is unavailable.");
              }

              return JSON.parse(payloadNode.textContent);
            }

            function setFont(context, size, weight) {
              context.font =
                String(weight) +
                " " +
                String(size) +
                'px "Noto Sans Tamil", "Nirmala UI", "Latha", Arial, Helvetica, sans-serif';
              context.textBaseline = "top";
              context.fillStyle = "#000000";
            }

            function getLineHeight(size, ratio) {
              return Math.ceil(size * ratio);
            }

            function wrapText(context, value, maxWidth) {
              var text = String(value || "").replace(/\\s+/g, " ").trim();
              if (!text) {
                return [""];
              }

              var words = text.split(" ");
              var lines = [];
              var current = "";

              function pushBrokenWord(word) {
                var chunk = "";
                for (var index = 0; index < word.length; index += 1) {
                  var candidate = chunk + word[index];
                  if (chunk && context.measureText(candidate).width > maxWidth) {
                    lines.push(chunk);
                    chunk = word[index];
                  } else {
                    chunk = candidate;
                  }
                }

                if (chunk) {
                  current = chunk;
                }
              }

              for (var i = 0; i < words.length; i += 1) {
                var word = words[i];
                if (!current) {
                  if (context.measureText(word).width <= maxWidth) {
                    current = word;
                  } else {
                    pushBrokenWord(word);
                  }
                  continue;
                }

                var candidateLine = current + " " + word;
                if (context.measureText(candidateLine).width <= maxWidth) {
                  current = candidateLine;
                  continue;
                }

                lines.push(current);
                if (context.measureText(word).width <= maxWidth) {
                  current = word;
                } else {
                  current = "";
                  pushBrokenWord(word);
                }
              }

              if (current) {
                lines.push(current);
              }

              return lines.length > 0 ? lines : [text];
            }

            function drawWrappedText(context, text, x, y, maxWidth, options) {
              setFont(context, options.size, options.weight);
              var lines = options.noWrap
                ? [String(text || "").trim()]
                : wrapText(context, text, maxWidth);
              var lineHeight = getLineHeight(options.size, options.lineHeightRatio || 1.3);

              for (var index = 0; index < lines.length; index += 1) {
                var line = lines[index];
                var drawX = x;

                if (options.align === "center") {
                  drawX = x + (maxWidth - context.measureText(line).width) / 2;
                } else if (options.align === "right") {
                  drawX = x + maxWidth - context.measureText(line).width;
                }

                context.fillText(line, drawX, y + index * lineHeight);
              }

              return {
                height: lines.length * lineHeight,
                lines: lines,
              };
            }

            function measureFittedTextHeight(context, text, maxWidth, options) {
              var size = options.size;
              var minSize = options.minSize || Math.max(12, Math.floor(size * 0.6));
              var line = String(text || "").trim();

              while (size > minSize) {
                setFont(context, size, options.weight);
                if (context.measureText(line).width <= maxWidth) {
                  break;
                }
                size -= 1;
              }

              return getLineHeight(size, options.lineHeightRatio || 1.3);
            }

            function drawFittedText(context, text, x, y, maxWidth, options) {
              var size = options.size;
              var minSize = options.minSize || Math.max(12, Math.floor(size * 0.6));
              var line = String(text || "").trim();
              var align = options.align || "right";

              while (size > minSize) {
                setFont(context, size, options.weight);
                if (context.measureText(line).width <= maxWidth) {
                  break;
                }
                size -= 1;
              }

              setFont(context, size, options.weight);
              var drawX = x;
              if (align === "right") {
                drawX = x + maxWidth - context.measureText(line).width;
              } else if (align === "center") {
                drawX = x + (maxWidth - context.measureText(line).width) / 2;
              }

              context.fillText(line, drawX, y);
              return getLineHeight(size, options.lineHeightRatio || 1.3);
            }

            function sliceCanvasToBase64Chunks(canvas) {
              var maxSliceHeight = 900;
              var chunks = [];
              var sliceTop = 0;

              while (sliceTop < canvas.height) {
                var sliceHeight = Math.min(maxSliceHeight, canvas.height - sliceTop);
                var sliceCanvas = document.createElement("canvas");
                sliceCanvas.width = canvas.width;
                sliceCanvas.height = sliceHeight;

                var sliceContext = sliceCanvas.getContext("2d");
                if (!sliceContext) {
                  throw new Error("Canvas context is unavailable.");
                }

                sliceContext.fillStyle = "#FFFFFF";
                sliceContext.fillRect(0, 0, sliceCanvas.width, sliceCanvas.height);
                sliceContext.drawImage(
                  canvas,
                  0,
                  sliceTop,
                  canvas.width,
                  sliceHeight,
                  0,
                  0,
                  sliceCanvas.width,
                  sliceCanvas.height
                );

                chunks.push(
                  sliceCanvas
                    .toDataURL("image/png")
                    .replace(/^data:image\\/png;base64,/, "")
                );

                sliceTop += sliceHeight;
              }

              return chunks;
            }

            function renderReceiptToCanvas(payload) {
              var receiptWidth = 380;
              var bottomFeedPadding = 70;
              var measureCanvas = document.createElement("canvas");
              var measureContext = measureCanvas.getContext("2d");
              if (!measureContext) {
                throw new Error("Canvas context is unavailable.");
              }

              var columnItemWidth = Math.floor(receiptWidth * 0.50);
              var columnQtyWidth = Math.floor(receiptWidth * 0.18);
              var columnTotalWidth = receiptWidth - columnItemWidth - columnQtyWidth;
              var totalLabelWidth = Math.floor(receiptWidth * 0.42);
              var totalValueWidth = receiptWidth - totalLabelWidth;
              var xItem = 0;
              var xQty = columnItemWidth;
              var xTotal = columnItemWidth + columnQtyWidth;

              function measureLayout() {
                var y = 0;

                y += drawWrappedText(measureContext, payload.companyName, 0, y, receiptWidth, {
                  size: 24,
                  weight: 800,
                  align: "center",
                  lineHeightRatio: 1.15,
                }).height;
                y += 3;

                y += drawWrappedText(measureContext, payload.shopName, 0, y, receiptWidth, {
                  size: 19,
                  weight: 800,
                  align: "center",
                  lineHeightRatio: 1.15,
                }).height;
                y += 7;
                y += 10;

                y += drawWrappedText(measureContext, payload.billText, 0, y, receiptWidth, {
                  size: 15,
                  weight: 600,
                  align: "center",
                  lineHeightRatio: 1.4,
                }).height;
                y += 4;

                if (payload.purchaserText) {
                  y += drawWrappedText(measureContext, payload.purchaserText, 0, y, receiptWidth, {
                    size: 24,
                    weight: 800,
                    align: "center",
                    lineHeightRatio: 1.15,
                  }).height;
                  y += 4;
                }

                y += drawWrappedText(measureContext, payload.dateText, 0, y, receiptWidth, {
                  size: 19,
                  weight: 800,
                  align: "center",
                  lineHeightRatio: 1.15,
                }).height;

                if (payload.openingBalanceLabel && payload.openingBalanceValue) {
                  y += 8;
                  y += 7;
                  y += drawWrappedText(
                    measureContext,
                    payload.openingBalanceLabel + ": " + payload.openingBalanceValue,
                    0,
                    y,
                    receiptWidth,
                    {
                      size: 19,
                      weight: 800,
                      align: "center",
                      lineHeightRatio: 1.15,
                    },
                  ).height;
                  y += 8;
                  y += 7;
                } else {
                  y += 10;
                }

                y += 7;

                var headerHeight = getLineHeight(14, 1.2);
                y += headerHeight;
                y += 7;

                for (var itemIndex = 0; itemIndex < payload.items.length; itemIndex += 1) {
                  var item = payload.items[itemIndex];
                  setFont(measureContext, 18, 800);
                  var itemNameLines = wrapText(measureContext, item.itemName, columnItemWidth - 6);
                  var itemNameHeight = itemNameLines.length * getLineHeight(18, 1.3);
                  var qtyHeight = getLineHeight(22, 1.15);
                  var totalHeight = measureFittedTextHeight(measureContext, item.lineTotal, columnTotalWidth, {
                    size: 21,
                    weight: 800,
                    lineHeightRatio: 1.15,
                  });
                  var rowHeight = Math.max(itemNameHeight, qtyHeight, totalHeight);

                  y += 8;
                  y += rowHeight;
                  y += 8;
                }

                y += 10;
                y += 4;

                y += measureFittedTextHeight(measureContext, payload.cashValue, totalValueWidth, {
                  size: 18,
                  weight: 700,
                  lineHeightRatio: 1.3,
                });
                y += 8;
                y += measureFittedTextHeight(measureContext, payload.upiValue, totalValueWidth, {
                  size: 18,
                  weight: 700,
                  lineHeightRatio: 1.3,
                });
                y += 12;
                y += measureFittedTextHeight(measureContext, payload.totalValue, totalValueWidth, {
                  size: 26,
                  weight: 800,
                  lineHeightRatio: 1.2,
                });
                y += 8;
                if (payload.paidAmountLabel || payload.balanceAmountLabel) {
                  y += 10;
                }
                if (payload.paidAmountLabel && payload.paidAmountValue) {
                  y += 8;
                  y += measureFittedTextHeight(measureContext, payload.paidAmountValue, totalValueWidth, {
                    size: 18,
                    weight: 800,
                    lineHeightRatio: 1.3,
                  });
                }
                if (payload.balanceAmountLabel && payload.balanceAmountValue) {
                  y += measureFittedTextHeight(measureContext, payload.balanceAmountValue, totalValueWidth, {
                    size: 18,
                    weight: 800,
                    lineHeightRatio: 1.3,
                  });
                }
                if (payload.totalBalanceLabel && payload.totalBalanceValue) {
                  y += 10;
                  y += 8;
                  y += measureFittedTextHeight(measureContext, payload.totalBalanceValue, totalValueWidth, {
                    size: 26,
                    weight: 800,
                    lineHeightRatio: 1.2,
                  });
                }
                y += 18;
                y += 14;
                y += getLineHeight(19, 1.3);
                y += 8;
                y += getLineHeight(13, 1.3);
                y += 6;
                y += getLineHeight(19, 1.3);
                y += bottomFeedPadding;

                return y;
              }

              var receiptHeight = Math.max(1, measureLayout());
              var scale = 2;
              var canvas = document.createElement("canvas");
              canvas.width = receiptWidth * scale;
              canvas.height = receiptHeight * scale;

              var context = canvas.getContext("2d");
              if (!context) {
                throw new Error("Canvas context is unavailable.");
              }

              context.scale(scale, scale);
              context.fillStyle = "#FFFFFF";
              context.fillRect(0, 0, receiptWidth, receiptHeight);
              context.strokeStyle = "#000000";

              var y = 0;

              y += drawWrappedText(context, payload.companyName, 0, y, receiptWidth, {
                size: 24,
                weight: 800,
                align: "center",
                lineHeightRatio: 1.15,
              }).height;
              y += 3;

              y += drawWrappedText(context, payload.shopName, 0, y, receiptWidth, {
                size: 19,
                weight: 800,
                align: "center",
                lineHeightRatio: 1.15,
              }).height;
              y += 7;

              context.lineWidth = 2.5;
              context.beginPath();
              context.moveTo(0, y);
              context.lineTo(receiptWidth, y);
              context.stroke();
              y += 10;

              y += drawWrappedText(context, payload.billText, 0, y, receiptWidth, {
                size: 15,
                weight: 600,
                align: "center",
                lineHeightRatio: 1.4,
              }).height;
              y += 4;

              if (payload.purchaserText) {
                y += drawWrappedText(context, payload.purchaserText, 0, y, receiptWidth, {
                  size: 24,
                  weight: 800,
                  align: "center",
                  lineHeightRatio: 1.15,
                }).height;
                y += 4;
              }

              y += drawWrappedText(context, payload.dateText, 0, y, receiptWidth, {
                size: 19,
                weight: 800,
                align: "center",
                lineHeightRatio: 1.15,
              }).height;

              if (payload.openingBalanceLabel && payload.openingBalanceValue) {
                y += 8;
                context.lineWidth = 2.5;
                context.beginPath();
                context.moveTo(0, y);
                context.lineTo(receiptWidth, y);
                context.stroke();
                y += 7;

                y += drawWrappedText(
                  context,
                  payload.openingBalanceLabel + ": " + payload.openingBalanceValue,
                  0,
                  y,
                  receiptWidth,
                  {
                    size: 19,
                    weight: 800,
                    align: "center",
                    lineHeightRatio: 1.15,
                  },
                ).height;
                y += 8;

                context.beginPath();
                context.moveTo(0, y);
                context.lineTo(receiptWidth, y);
                context.stroke();
                y += 7;
              } else {
                y += 10;
              }

              context.lineWidth = 2.5;
              context.beginPath();
              context.moveTo(0, y);
              context.lineTo(receiptWidth, y);
              context.stroke();
              y += 7;
              drawWrappedText(context, payload.itemHeader, xItem, y, columnItemWidth, {
                size: 14,
                weight: 800,
                align: "left",
                lineHeightRatio: 1.2,
              });
              drawWrappedText(context, payload.quantityHeader, xQty, y, columnQtyWidth - 4, {
                size: 14,
                weight: 800,
                align: "right",
                lineHeightRatio: 1.2,
              });
              drawWrappedText(context, payload.totalHeader, xTotal, y, columnTotalWidth, {
                size: 14,
                weight: 800,
                align: "right",
                lineHeightRatio: 1.2,
              });
              y += getLineHeight(14, 1.2);
              y += 7;

              context.lineWidth = 2.5;
              context.beginPath();
              context.moveTo(0, y);
              context.lineTo(receiptWidth, y);
              context.stroke();

              for (var itemIndex = 0; itemIndex < payload.items.length; itemIndex += 1) {
                var item = payload.items[itemIndex];

                y += 8;
                var itemName = drawWrappedText(context, item.itemName, xItem, y, columnItemWidth - 6, {
                  size: 18,
                  weight: 800,
                  align: "left",
                  lineHeightRatio: 1.3,
                });
                var qtyBlock = drawWrappedText(context, item.quantityText, xQty, y, columnQtyWidth - 4, {
                  size: 22,
                  weight: 700,
                  align: "right",
                  lineHeightRatio: 1.15,
                  noWrap: true,
                });
                var totalBlockHeight = drawFittedText(context, item.lineTotal, xTotal, y, columnTotalWidth, {
                  size: 21,
                  weight: 800,
                  align: "right",
                  lineHeightRatio: 1.15,
                });

                y += Math.max(itemName.height, qtyBlock.height, totalBlockHeight);
                y += 8;
              }

              context.lineWidth = 2.5;
              context.beginPath();
              context.moveTo(0, y);
              context.lineTo(receiptWidth, y);
              context.stroke();
              y += 10;

              function drawTotalRow(label, value, fontSize, fontWeight) {
                var labelBlock = drawWrappedText(context, label, 0, y, totalLabelWidth, {
                  size: fontSize,
                  weight: fontWeight,
                  align: "left",
                  lineHeightRatio: 1.3,
                });
                var valueHeight = drawFittedText(context, value, totalLabelWidth, y, totalValueWidth, {
                  size: fontSize,
                  weight: fontWeight,
                  align: "right",
                  lineHeightRatio: 1.3,
                });
                return Math.max(labelBlock.height, valueHeight);
              }

              y += drawTotalRow(payload.cashLabel, payload.cashValue, 18, 700);
              y += 8;

              y += drawTotalRow(payload.upiLabel, payload.upiValue, 18, 700);
              context.lineWidth = 1.5;
              context.beginPath();
              context.moveTo(0, y + 4);
              context.lineTo(receiptWidth, y + 4);
              context.stroke();
              y += 12;

              y += drawTotalRow(payload.totalLabel, payload.totalValue, 26, 800);
              y += 8;

              if (payload.paidAmountLabel || payload.balanceAmountLabel) {
                context.lineWidth = 2.5;
                context.beginPath();
                context.moveTo(0, y);
                context.lineTo(receiptWidth, y);
                context.stroke();
                y += 10;
              }

              if (payload.paidAmountLabel && payload.paidAmountValue) {
                y += drawTotalRow(payload.paidAmountLabel, payload.paidAmountValue, 18, 800);
                y += 8;
              }

              if (payload.balanceAmountLabel && payload.balanceAmountValue) {
                y += drawTotalRow(payload.balanceAmountLabel, payload.balanceAmountValue, 18, 800);
              }

              if (payload.totalBalanceLabel && payload.totalBalanceValue) {
                context.lineWidth = 2.5;
                context.beginPath();
                context.moveTo(0, y);
                context.lineTo(receiptWidth, y);
                context.stroke();
                y += 10;
                y += drawTotalRow(payload.totalBalanceLabel, payload.totalBalanceValue, 26, 800);
              }

              context.lineWidth = 2.5;
              context.beginPath();
              context.moveTo(0, y);
              context.lineTo(receiptWidth, y);
              context.stroke();
              y += 18;

              context.lineWidth = 1.5;
              context.setLineDash([6, 4]);
              context.beginPath();
              context.moveTo(0, y);
              context.lineTo(receiptWidth, y);
              context.stroke();
              context.setLineDash([]);
              y += 14;

              y += drawWrappedText(context, payload.thankYou, 0, y, receiptWidth, {
                size: 19,
                weight: 800,
                align: "center",
                lineHeightRatio: 1.3,
              }).height;
              y += 8;

              y += drawWrappedText(context, payload.poweredBy, 0, y, receiptWidth, {
                size: 13,
                weight: 700,
                align: "center",
                lineHeightRatio: 1.3,
              }).height;
              y += 6;

              drawWrappedText(context, payload.provider, 0, y, receiptWidth, {
                size: 19,
                weight: 800,
                align: "center",
                lineHeightRatio: 1.3,
              });

              y += getLineHeight(19, 1.3);
              context.fillStyle = "#FFFFFF";
              context.fillRect(0, y, receiptWidth, bottomFeedPadding);

              return canvas;
            }

            function renderReceiptToShareCanvas(payload) {
              var marginTop = 24;
              var marginLeft = 20;
              var marginRight = 20;
              var scale = 2;
              var receiptCanvas = renderReceiptToCanvas(payload);
              var outputCanvas = document.createElement("canvas");
              outputCanvas.width = receiptCanvas.width + (marginLeft + marginRight) * scale;
              outputCanvas.height = receiptCanvas.height + marginTop * scale;

              var outputContext = outputCanvas.getContext("2d");
              if (!outputContext) {
                throw new Error("Canvas context is unavailable.");
              }

              outputContext.fillStyle = "#FFFFFF";
              outputContext.fillRect(0, 0, outputCanvas.width, outputCanvas.height);
              outputContext.drawImage(receiptCanvas, marginLeft * scale, marginTop * scale);
              return outputCanvas;
            }

            window.__EXPORT_RECEIPT_IMAGE__ = async function () {
              try {
                await waitForFonts();
                var payload = loadReceiptExportPayload();
                var canvas = renderReceiptToCanvas(payload);
                var base64Chunks = sliceCanvasToBase64Chunks(canvas);
                postMessage({ type: "receipt-export", payload: base64Chunks });
              } catch (error) {
                postMessage({
                  type: "receipt-export-error",
                  payload: error instanceof Error ? error.message : String(error),
                });
              }
            };

            window.__EXPORT_RECEIPT_SHARE_IMAGE__ = async function () {
              try {
                await waitForFonts();
                var payload = loadReceiptExportPayload();
                var canvas = renderReceiptToShareCanvas(payload);
                postMessage({
                  type: "receipt-share-export",
                  payload: canvas
                    .toDataURL("image/png")
                    .replace(/^data:image\\/png;base64,/, ""),
                });
              } catch (error) {
                postMessage({
                  type: "receipt-export-error",
                  payload: error instanceof Error ? error.message : String(error),
                });
              }
            };
          })();
        </script>`;
}

type ReceiptExportItem = {
  itemName: string;
  quantityText: string;
  lineTotal: string;
};

type ReceiptExportPayload = {
  companyName: string;
  shopName: string;
  billText: string;
  purchaserText?: string;
  dateText: string;
  openingBalanceLabel?: string;
  openingBalanceValue?: string;
  itemHeader: string;
  quantityHeader: string;
  totalHeader: string;
  cashLabel: string;
  cashValue: string;
  upiLabel: string;
  upiValue: string;
  totalLabel: string;
  totalValue: string;
  paidAmountLabel?: string;
  paidAmountValue?: string;
  balanceAmountLabel?: string;
  balanceAmountValue?: string;
  totalBalanceLabel?: string;
  totalBalanceValue?: string;
  thankYou: string;
  poweredBy: string;
  provider: string;
  items: ReceiptExportItem[];
};

function serializeReceiptExportPayload(payload: ReceiptExportPayload) {
  return JSON.stringify(payload)
    .replaceAll("<", "\\u003c")
    .replaceAll(">", "\\u003e")
    .replaceAll("&", "\\u0026");
}

export function buildReceiptHtmlMarkup(
  receiptMarkup: string,
  exportPayload?: ReceiptExportPayload,
) {
  return `
    <html lang="ta">
      <head>
        <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0" />
        <meta charset="utf-8" />
        <style>
          @page {
            margin: 0;
          }

          * {
            box-sizing: border-box;
            -webkit-print-color-adjust: exact;
            print-color-adjust: exact;
            text-shadow: none !important;
            box-shadow: none !important;
          }

          html {
            background: #fff;
          }

          body {
            font-family: "Noto Sans Tamil", "Nirmala UI", "Latha", Arial, Helvetica, sans-serif;
            color: #000000;
            margin: 0;
            padding: 12px;
            font-size: 14px;
            line-height: 1.3;
            background: #fff;
            font-weight: 600;
            text-rendering: optimizeLegibility;
            -webkit-font-smoothing: antialiased;
            -webkit-text-size-adjust: 100%;
            text-size-adjust: 100%;
            font-kerning: none;
            letter-spacing: 0;
          }

          .receipt-stack {
            display: flex;
            flex-direction: column;
            gap: 20px;
          }

          .receipt-container {
            width: 100%;
            max-width: 380px;
            margin: 0 auto;
          }

          .receipt-container + .receipt-container {
            padding-top: 18px;
            border-top: 2px dashed #d3d3d3;
          }

          .center { text-align: center; }
          .align-right { text-align: right; }
          .strong { font-weight: 700; }

          .header-main {
            font-size: 24px;
            letter-spacing: -0.4px;
            line-height: 1.15;
            margin-bottom: 3px;
            white-space: normal;
            word-break: break-word;
            overflow-wrap: anywhere;
            color: #000000;
            font-weight: 800;
          }
          .header-sub {
            font-size: 19px;
            line-height: 1.15;
            margin-bottom: 10px;
            border-bottom: 2.5px solid #000000;
            padding-bottom: 7px;
            white-space: normal;
            word-break: break-word;
            overflow-wrap: anywhere;
            color: #000000;
            font-weight: 800;
          }
          .bill-meta {
            font-size: 15px;
            line-height: 1.4;
            margin-bottom: 10px;
            color: #000000;
            text-align: center;
          }
          .bill-meta span {
            display: block;
            margin-bottom: 3px;
          }
          .bill-meta span:last-child {
            margin-bottom: 0;
          }
          .bill-meta-purchaser {
            font-size: 24px;
            font-weight: 800;
            line-height: 1.15;
          }
          .bill-meta-shop {
            font-size: 19px;
            font-weight: 800;
            line-height: 1.15;
          }
          .bill-meta-primary {
            font-size: 19px;
            font-weight: 800;
            line-height: 1.15;
          }
          .balance-divider {
            border-top: 2.5px solid #000000;
            margin: 8px 0;
          }
          .opening-balance-row {
            margin-bottom: 0;
          }
          .total-balance-divider td {
            border-top: 2.5px solid #000000;
            padding-top: 8px;
          }

          table {
            width: 100%;
            border-collapse: collapse;
            table-layout: fixed;
          }
          col.col-item-name  { width: 50%; }
          col.col-item-qty   { width: 18%; }
          col.col-item-total { width: 32%; }
          col.col-total-label { width: 42%; }
          col.col-total-value { width: 58%; }

          .items-header { border-bottom: 2.5px solid #000000; border-top: 2.5px solid #000000; }
          .items-header th {
            padding: 7px 0;
            font-size: 14px;
            font-weight: 800;
            text-transform: uppercase;
            line-height: 1.2;
            color: #000000;
            white-space: nowrap;
            overflow: hidden;
          }
          .items-header th:nth-child(2),
          .items-header th:nth-child(3) {
            text-align: right;
          }

          .item-row td {
            padding-top: 8px;
            padding-bottom: 8px;
            vertical-align: top;
            line-height: 1.3;
          }
          .item-name {
            font-size: 18px;
            padding-right: 6px;
            color: #000000;
            font-weight: 800;
            white-space: normal;
            word-break: break-word;
            overflow-wrap: anywhere;
          }
          .item-qty {
            font-size: 22px;
            text-align: right;
            white-space: nowrap;
            color: #000000;
            font-weight: 700;
            padding-right: 4px;
          }
          .item-total {
            font-size: 17px;
            text-align: right;
            white-space: nowrap;
            font-variant-numeric: tabular-nums;
            color: #000000;
            font-weight: 800;
          }

          .payment-divider {
            border-top: 2.5px solid #000000;
            margin-top: 10px;
          }

          .upi-bottom-divider {
            border-bottom: 1.5px solid #000000;
            padding-bottom: 4px;
            margin-bottom: 4px;
          }

          .totals-section { margin-top: 4px; width: 100%; table-layout: fixed; }
          .total-row td {
            padding: 4px 0;
            font-size: 18px;
            font-weight: 700;
            line-height: 1.3;
            color: #000000;
          }
          .total-row td:last-child {
            white-space: nowrap;
            font-variant-numeric: tabular-nums;
          }
          .grand-total td {
            font-size: 26px;
            font-weight: 800;
            padding-top: 8px;
            color: #000000;
          }
          .grand-total td:last-child {
            font-size: 20px;
          }

          .footer {
            margin-top: 18px;
            border-top: 1.5px dashed #7f7f7f;
            padding-top: 14px;
          }
          .thank-you {
            font-size: 19px;
            font-weight: 800;
            line-height: 1.3;
            color: #000000;
          }
          .footer-note {
            font-size: 13px;
            font-weight: 700;
            color: #000000;
            margin: 8px 0 6px;
          }
          .total-divider { border-top: 2.5px solid #000000; margin: 8px 0; }

          @media (max-width: 360px) {
            .header-main { font-size: 20px; }
            .header-sub  { font-size: 17px; }
            .bill-meta          { font-size: 13px; }
            .bill-meta-purchaser { font-size: 20px; }
            .bill-meta-shop { font-size: 17px; }
            .bill-meta-primary  { font-size: 17px; }
            .item-name   { font-size: 16px; }
            .item-qty    { font-size: 17px; }
            .item-total  { font-size: 16px; }
          }
        </style>
      </head>
      <body>
        <div class="receipt-stack">
          ${receiptMarkup}
        </div>
        ${
          exportPayload
            ? `<script id="receipt-export-data" type="application/json">${serializeReceiptExportPayload(exportPayload)}</script>`
            : ""
        }
        ${buildReceiptImageExportScript()}
      </body>
    </html>`;
}

function formatBillNoDisplay(billNo: string | null | undefined) {
  const trimmed = billNo?.trim();
  return trimmed ? trimmed : "—";
}

export function buildReceiptText(bill: BillRead, language?: ShopLanguage) {
  const copy = getReceiptCopy("en");
  const lines = [
    formatReceiptOrganizationName(bill.organization_name, "en"),
    formatReceiptShopName(bill.shop_name, "en"),
    `${copy.receipt}: ${bill.receipt.receipt_number}`,
    `${copy.bill}: ${formatBillNoDisplay(bill.bill_no)}`,
    `${copy.date}: ${formatDateTime(bill.created_at)}`,
    `----------------------------------------`,
    copy.items,
    "",
    ...bill.items.map(
      (item) =>
        `${getLocalizedItemName("ta", item.item_name, item.item_tamil_name).padEnd(15)} ${item.quantity}${formatUnit(item.unit).padEnd(5)} x ${formatReceiptCurrency(item.price_per_unit)} = ${formatReceiptCurrency(item.line_total)}`,
    ),
    "",
    `----------------------------------------`,
    `${copy.cash}: ${formatReceiptCurrency(bill.payment.cash_amount)}`,
    `${copy.upi}: ${formatReceiptCurrency(bill.payment.upi_amount)}`,
    `${copy.total}: ${formatReceiptCurrency(bill.total_amount)}`,
    `----------------------------------------`,
    copy.thankYou,
    "", // Note: leave some blank lines at the end so the printer rolls the paper up!
    "",
    "",
    "",
  ];

  return lines.join("\n");
}

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "'");
}

// If rate is needed in the future, we can add it as a hidden column in the HTML and use CSS to show it only when needed. This way we can avoid breaking existing printer templates that might rely on the current structure of the receipt.
// <tr>
//           <td colspan="3" class="item-calc-row">
//              ${copy.rate}: ${formatReceiptCurrency(item.price_per_unit)} / ${formatUnit(item.unit)}
//           </td>
//         </tr>

function buildReceiptHtmlBody(bill: BillRead, language?: ShopLanguage) {
  const resolvedLanguage = "en";
  const copy = getReceiptCopy(resolvedLanguage);
  const organizationName = formatReceiptOrganizationName(
    bill.organization_name,
    resolvedLanguage,
  );
  const showBalance = Number(bill.payment.balance) > 0;
  const itemRows = bill.items
    .map(
      (item) => `
        <tr class="item-row">
          <td class="item-name strong">${escapeHtml(getLocalizedItemName("ta", item.item_name, item.item_tamil_name))}</td>
          <td class="align-right item-qty">${escapeHtml(String(item.quantity))}&nbsp;${escapeHtml(formatUnit(item.unit))}</td>
          <td class="align-right item-total strong">${formatReceiptCurrency(item.line_total)}</td>
        </tr>
        `,
    )
    .join("");

  return `
    <div class="receipt-container">
      <div class="center">
        <div class="strong header-main">${escapeHtml(organizationName)}</div>
        <div class="strong header-sub">${escapeHtml(formatReceiptShopName(bill.shop_name, resolvedLanguage))}</div>
      </div>

      <div class="bill-meta">
        <span><strong>${copy.bill}:</strong> ${escapeHtml(formatBillNoDisplay(bill.bill_no))}</span>
        <span><strong>${copy.date}:</strong> ${escapeHtml(formatDateTime(bill.created_at))}</span>
      </div>

      <table>
        <colgroup>
          <col class="col-item-name" />
          <col class="col-item-qty" />
          <col class="col-item-total" />
        </colgroup>
        <thead>
          <tr class="items-header">
            <th align="left">${copy.item}</th>
            <th align="right">${copy.quantityUnit}</th>
            <th align="right">${copy.total}</th>
          </tr>
        </thead>
        <tbody>
          ${itemRows}
        </tbody>
      </table>

      <div class="payment-divider"></div>

      <table class="totals-section">
        <colgroup>
          <col class="col-total-label" />
          <col class="col-total-value" />
        </colgroup>
        <tr class="total-row">
          <td>${copy.cash}</td>
          <td class="align-right">${formatReceiptCurrency(bill.payment.cash_amount)}</td>
        </tr>
        <tr class="total-row">
          <td class="upi-bottom-divider">${copy.upi}</td>
          <td class="align-right upi-bottom-divider">${formatReceiptCurrency(bill.payment.upi_amount)}</td>
        </tr>
        <tr class="total-row grand-total">
          <td class="strong">${copy.total}</td>
          <td class="align-right strong">Rs. ${formatReceiptCurrency(bill.total_amount)}</td>
        </tr>
        ${
          showBalance
            ? `
        <tr class="total-row">
          <td class="strong">Paid</td>
          <td class="align-right strong">Rs. ${formatReceiptCurrency(bill.payment.total_paid)}</td>
        </tr>
        <tr class="total-row">
          <td class="strong">Balance Due</td>
          <td class="align-right strong">Rs. ${formatReceiptCurrency(bill.payment.balance)}</td>
        </tr>`
            : ""
        }
      </table>

      <div class="total-divider"></div>

      <div class="center footer">
        <div class="strong thank-you">${copy.thankYou}</div>
        <div class="footer-note">${copy.poweredBy}</div>
        <div class="strong thank-you">${copy.provider}</div>
      </div>
    </div>`;
}

function buildReceiptExportPayload(bill: BillRead, language?: ShopLanguage): ReceiptExportPayload {
  const resolvedLanguage = "en";
  const copy = getReceiptCopy(resolvedLanguage);

  return {
    companyName: formatReceiptOrganizationName(bill.organization_name, resolvedLanguage),
    shopName: formatReceiptShopName(bill.shop_name, resolvedLanguage),
    billText: `${copy.bill}: ${formatBillNoDisplay(bill.bill_no)}`,
    dateText: `${copy.date}: ${formatDateTime(bill.created_at)}`,
    itemHeader: copy.item,
    quantityHeader: copy.quantityUnit,
    totalHeader: copy.total,
    cashLabel: copy.cash,
    cashValue: formatReceiptCurrency(bill.payment.cash_amount),
    upiLabel: copy.upi,
    upiValue: formatReceiptCurrency(bill.payment.upi_amount),
    totalLabel: copy.total,
    totalValue: `Rs. ${formatReceiptCurrency(bill.total_amount)}`,
    thankYou: copy.thankYou,
    poweredBy: copy.poweredBy,
    provider: copy.provider,
    items: bill.items.map((item) => ({
      itemName: getLocalizedItemName("ta", item.item_name, item.item_tamil_name),
      quantityText: `${item.quantity} ${formatUnit(item.unit)}`,
      lineTotal: formatReceiptCurrency(item.line_total),
    })),
  };
}

export function buildReceiptHtml(bill: BillRead, language?: ShopLanguage) {
  return buildReceiptHtmlMarkup(
    buildReceiptHtmlBody(bill, language),
    buildReceiptExportPayload(bill, language),
  );
}

export function buildBatchReceiptHtml(bills: BillRead[], language?: ShopLanguage) {
  return buildReceiptHtmlMarkup(bills.map((bill) => buildReceiptHtmlBody(bill, language)).join(""));
}

export function retailerSaleToBillRead(
  sale: RetailerSaleRead,
  receipt?: RetailerSaleReceiptRead,
): BillRead {
  const invoiceReceipt =
    receipt ??
    sale.receipt ??
    sale.receipts?.find((row) => row.receipt_type === "sale_invoice") ??
    sale.receipts?.[0];
  const linkedPayment =
    sale.payments.find((payment) => payment.id === invoiceReceipt?.retailer_payment_id) ??
    sale.payments[0];
  const paidAtCheckout = linkedPayment?.total_paid ?? sale.amount_paid_total;
  const balanceAtInvoice = invoiceReceipt
    ? String(Number(sale.total_amount) - Number(paidAtCheckout))
    : sale.balance_due;
  return {
    id: sale.id,
    bill_no: sale.sale_no,
    shop_id: sale.shop_id,
    shop_name: sale.shop_name,
    organization_name: `${sale.organization_name}\nRetailer Sale · ${sale.retailer_name}\n${sale.shop_name}`,
    total_amount: sale.total_amount,
    status:
      Number(balanceAtInvoice) === 0 ? BillStatus.PAID : BillStatus.PENDING_PAYMENT,
    created_at: sale.created_at,
    items: sale.items.map((item) => ({
      item_id: item.item_id,
      item_name: item.item_name,
      item_tamil_name: item.item_tamil_name,
      item_unit_type: item.item_unit_type,
      item_base_unit: item.item_base_unit,
      quantity: item.quantity,
      unit: item.unit,
      price_per_unit: item.price_per_unit,
      line_total: item.line_total,
    })),
    payment: {
      id: linkedPayment?.id ?? sale.id,
      cash_amount: linkedPayment?.cash_amount ?? "0.00",
      upi_amount: linkedPayment?.upi_amount ?? "0.00",
      total_paid: paidAtCheckout,
      balance: balanceAtInvoice,
      is_settled: Number(balanceAtInvoice) === 0,
    },
    receipt: {
      id: invoiceReceipt?.id ?? sale.id,
      receipt_number: invoiceReceipt?.receipt_number ?? `RCT-${sale.sale_no}`,
      printed_at: invoiceReceipt?.printed_at ?? sale.created_at,
      receipt_status: invoiceReceipt?.printed_at ? "printed" : "pending",
      print_attempts: invoiceReceipt?.printed_at ? 1 : 0,
    },
  };
}
