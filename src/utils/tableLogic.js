
$(document).ready(function () {

    // ===================================================================================
    // 1. THE VISUAL GRID MAPPER
    // ===================================================================================
    class VisualGridMapper {
        constructor(table) {
            this.table = $(table);
            this.grid = [];
            this.cellMap = new Map();
            this.buildGrid();
        }

        buildGrid() {
            const rows = this.table.find('tr');
            let maxCols = 0;

            rows.each((rowIndex, row) => {
                this.grid[rowIndex] = this.grid[rowIndex] || [];
            });

            rows.each((rowIndex, row) => {
                let colIndex = 0;
                $(row).find('td, th').each((cellIndex, cell) => {
                    const $cell = $(cell);
                    const colspan = parseInt($cell.attr('colspan') || 1);
                    const rowspan = parseInt($cell.attr('rowspan') || 1);

                    while (this.grid[rowIndex][colIndex] !== undefined) {
                        colIndex++;
                    }

                    this.cellMap.set(cell, {
                        rowspan: rowspan,
                        colspan: colspan,
                        content: $cell.html(),
                        isHeader: $cell.is('th'),
                        startRow: rowIndex,
                        startCol: colIndex
                    });

                    for (let r = 0; r < rowspan; r++) {
                        this.grid[rowIndex + r] = this.grid[rowIndex + r] || [];
                        for (let c = 0; c < colspan; c++) {
                            this.grid[rowIndex + r][colIndex + c] = {
                                element: cell,
                                isOrigin: (r === 0 && c === 0)
                            };
                        }
                    }



                    colIndex += colspan;
                });
                maxCols = Math.max(maxCols, colIndex);
            });

            this.maxCols = maxCols;
            this.maxRows = this.grid.length;
        }
        getCellsInRow(rowIndex) {
            const cells = new Set();
            if (this.grid[rowIndex]) {
                this.grid[rowIndex].forEach(gridCell => {
                    if (gridCell) {
                        cells.add(gridCell.element);
                    }
                });
            }
            return Array.from(cells);
        }

        getCellsInColumn(colIndex) {
            const cells = new Set();
            this.grid.forEach(row => {
                if (row && row[colIndex]) {
                    cells.add(row[colIndex].element);
                }
            });
            return Array.from(cells);
        }

        getVisualPosition(cell) {
            return this.cellMap.get(cell);
        }
    }

    // ===================================================================================
    // 2. RE-USABLE INITIALIZATION FUNCTIONS
    // ===================================================================================

    /**
     * Finds all accordion headers and makes them clickable to toggle sibling rows.
     */
    function initAccordions() {
        // Use event delegation on a static parent for efficiency.
        // This listener lives on the body and catches clicks from any '.accordion-header'
        // even if the table is completely replaced.
        $('body').off('click.accordion').on('click.accordion', '.accordion-header', function () {
            $(this).toggleClass('actives');
            // Use nextUntil to grab all rows until the next header. It's perfect for this.
            $(this).closest('tr').nextUntil('.accordion-header').toggle();
        });
    }

    // function accordionButton() {
    //     $('.accordion').off('click.accordion').on('click.accordion', function () {
    //         $(this).toggleClass('active');
    //         const $panel = $(this).next('.panel');
    //         $panel.slideToggle(200); // toggles between display block/none
    //     });
    // }
    function accordionButton() {
        // Simple check: if any accordion element has event listeners, assume legacy is active
        const accordionElements = document.getElementsByClassName("accordion");

        let legacyDetected = false;
        for (let i = 0; i < accordionElements.length; i++) {
            // Check if element has click event listeners
            // This is a simple heuristic - if onclick is set or if we detect the pattern
            if (accordionElements[i].onclick || hasClickListeners(accordionElements[i])) {
                legacyDetected = true;
                break;
            }
        }

        if (legacyDetected) {
            console.log('Legacy accordion detected - jQuery version disabled');
            return;
        }

        // Initialize jQuery version
        $('.accordion').off('click.accordion').on('click.accordion', function () {
            $(this).toggleClass('active');
            const $panel = $(this).next('.panel');
            $panel.slideToggle(200);
        });
    }

    function hasClickListeners(element) {
        // This is a heuristic check - not 100% reliable but works for most cases
        // We can't directly detect addEventListener listeners, so we test behavior
        const originalClass = element.className;
        const panel = element.nextElementSibling;

        if (!panel) return false;

        const originalDisplay = panel.style.display;

        // Create and dispatch a click event
        const event = new Event('click');
        element.dispatchEvent(event);

        // Check if anything changed
        const hasListeners = (element.className !== originalClass) ||
            (panel.style.display !== originalDisplay);

        // If changes occurred, restore original state by clicking again
        if (hasListeners) {
            element.dispatchEvent(event);
        }

        return hasListeners;
    }


    /**
     * Wires up the crosshair highlighting feature for any table with the .crosshair-table class.
     */
    function initCrosshair() {
        $('.crosshair-table').each(function () {
            const $table = $(this);
            if ($table.data('crosshair-initialized')) return; // Skip if already done
            $table.data('crosshair-initialized', true);

            const mapper = new VisualGridMapper($table);

            // Use delegation for events so they work on any cells within this table
            $table.on('mouseenter', 'td, th', function () {
                const hoveredCell = this;
                const position = mapper.cellMap.get(hoveredCell);
                if (!position) return;

                $table.find('.highlight-row, .highlight-col').removeClass('highlight-row highlight-col');

                const rowCells = new Set(), colCells = new Set();
                for (let r = 0; r < position.rowspan; r++) {
                    mapper.getCellsInRow(position.startRow + r).forEach(cell => rowCells.add(cell));
                }
                for (let c = 0; c < position.colspan; c++) {
                    mapper.getCellsInColumn(position.startCol + c).forEach(cell => colCells.add(cell));
                }

                // Apply classes. CSS will handle the intersection color.
                $(Array.from(rowCells)).addClass('highlight-row');
                $(Array.from(colCells)).addClass('highlight-col');
            });

            $table.on('mouseleave', function () {
                $table.find('.highlight-row, .highlight-col').removeClass('highlight-row highlight-col');
            });
        });
    }

    /**
     * Wires up the column-hiding functionality based on the .sp-option selectors.
     * This is for Truncating tables to look smaller. By assigning sp-${spValue} will show whichever index it is in.
* ${spValue} is numbers from 1 - ~ (example. sp-1 for tab 1, sp-2 for tab 2, etc.)
*/
    function initSpSelectors() {
        // Use event delegation for the option clicks
        $('body').off('click.sp_selector').on('click.sp_selector', '.sp-option', function () {
            const $option = $(this);
            const panel = $option.closest('.panel');
            const table = panel.find('.tablecoil');
            const spValue = $option.data('value');

            // Update option buttons UI
            panel.find('.sp-option').removeClass('active');
            $option.addClass('active');

            // Hide all sp- columns
            table.find('[class*="sp-"]').removeClass('active');
            // Show the selected ones
            table.find(`.sp-${spValue}`).addClass('active');
        });
    }


    // ===================================================================================
    // 3. Table Transpose
    // ===================================================================================
    function transposeAllTables() {
        $('.transpose-table').each(function () {
            const $originalTable = $(this);

            //Store original classes and ID to reapply later ---
            const originalClasses = $originalTable.attr('class');
            const originalId = $originalTable.attr('id');

            // Since this is a destructive action, we unbind crosshair listeners to be safe.
            $originalTable.off('mouseenter mouseleave');

            const mapper = new VisualGridMapper($originalTable);
            const grid = mapper.grid;

            const transposedGrid = [];
            for (let c = 0; c < mapper.maxCols; c++) {
                transposedGrid[c] = [];
                for (let r = 0; r < mapper.maxRows; r++) {
                    transposedGrid[c][r] = (grid[r] && grid[r][c]) ? grid[r][c] : null;
                }
            }

            const $transposedTable = $('<table>')
                .addClass($originalTable.attr('class'))
                .attr('id', $originalTable.attr('id'));
            const visited = new Set();

            transposedGrid.forEach((row, rowIndex) => {
                const $tr = $('<tr>');
                row.forEach((gridCell, colIndex) => {
                    const key = `${rowIndex},${colIndex}`;
                    if (visited.has(key)) return;

                    if (!gridCell || !gridCell.element || !gridCell.isOrigin) {
                        if (!visited.has(key)) {
                            $tr.append('<td> </td>');
                        }
                        return;
                    }

                    // visited.add(gridCell.element);
                    const $originalCell = $(gridCell.element);
                    const cellInfo = mapper.cellMap.get(gridCell.element);
                    const newRowspan = cellInfo.colspan;
                    const newColspan = cellInfo.rowspan;

                    const $newCell = $(cellInfo.isHeader ? '<th>' : '<td>')
                        .addClass($originalCell.attr('class'))  // Preserve cell classes
                        .attr('id', $originalCell.attr('id'));  // Preserve cell ID
                    $newCell.html(cellInfo.content);
                    if (newRowspan > 1) $newCell.attr('rowspan', newRowspan);
                    if (newColspan > 1) $newCell.attr('colspan', newColspan);

                    $tr.append($newCell);

                    for (let r = 0; r < newRowspan; r++) {
                        for (let c = 0; c < newColspan; c++) {
                            visited.add(`${rowIndex + r},${colIndex + c}`);
                        }
                    }
                });

                // Preserve row classes and ID
                const originalRow = $(row[0].element).closest('tr');
                $tr.addClass(originalRow.attr('class'))
                    .attr('id', originalRow.attr('id'));

                $transposedTable.append($tr);
            });

            // Re-apply the original table's classes and ID
            // $transposedTable.addClass(originalClasses).attr('id', originalId);

            // Replace the original table in the DOM
            $originalTable.replaceWith($transposedTable);
        });

        // After all tables have been replaced, re-run the initializers.
        // They will find the new tables and attach fresh event listeners.
        console.log("Transposition complete. Re-initializing all features...");
        initializeAllFeatures();
    }

    // ===================================================================================
    // 4. MASTER INITIALIZATION
    // This function runs all our initializer scripts.
    // ===================================================================================
    function initializeAllFeatures() {
        initAccordions();
        initCrosshair();
        initSpSelectors();
        // if ($('body').hasClass('has-accordion')) {
        accordionButton();
        // }

        //--- Initialize default states ---
        const $firstPanel = $('.panel').first();
        if ($firstPanel.length) {
            $firstPanel.show();
            // Activate the first sp-option in the first panel by default
            $firstPanel.find('.sp-option').first().trigger('click.sp_selector');
        }
        // 
        $('.panel').show();
        $('.panel').find('.sp-option').trigger('click.sp_selector');
    }

    // --- RUN EVERYTHING ON PAGE LOAD ---
    transposeAllTables(); // Run transpose first if needed
    initializeAllFeatures(); // Then wire up all features
});