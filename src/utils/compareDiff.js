import * as Diff from 'diff';
import * as Diff2Html from 'diff2html';
import 'diff2html/bundles/css/diff2html.min.css'; // Don't forget the CSS!

async function comparePDFTables(pdf1Data, pdf2Data) {
    // 1. Get strings using your renderPDF/tableToDiffString logic
    const oldStr = tableToDiffString(pdf1Data.rows, pdf1Data.columns);
    const newStr = tableToDiffString(pdf2Data.rows, pdf2Data.columns);

    // 2. Create the unified diff patch
    const diffPatch = Diff.createTwoFilesPatch('Original PDF', 'Modified PDF', oldStr, newStr);

    // 3. Convert patch to GitHub-style HTML
    const diffHtml = Diff2Html.html(diffPatch, {
        drawFileList: false,
        matching: 'lines',
        outputFormat: 'side-by-side', // This creates the "Table" look
        renderNothingWhenEmpty: true
    });

    // 4. Inject into your page
    document.getElementById('diff-display-container').innerHTML = diffHtml;
}