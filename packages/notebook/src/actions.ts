// Copyright (c) Jupyter Development Team.
// Distributed under the terms of the Modified BSD License.

import {
  KernelMessage
} from '@jupyterlab/services';

import {
  IClientSession, Clipboard, Dialog, showDialog
} from '@jupyterlab/apputils';

import {
  nbformat
} from '@jupyterlab/coreutils';

import {
  ICellModel, ICodeCellModel,
  CodeCell, Cell, MarkdownCell
} from '@jupyterlab/cells';

import {
  ArrayExt, each, toArray
} from '@phosphor/algorithm';

import {
  ElementExt
} from '@phosphor/domutils';

import {
  INotebookModel
} from './model';

import {
  Notebook
} from './widget';


// The message to display to the user when prompting to trust the notebook.
const TRUST_MESSAGE = '<p>A trusted Jupyter notebook may execute hidden malicious code when you open it.<br>Selecting trust will re-render this notebook in a trusted state.<br>For more information, see the <a href="http://ipython.org/ipython-doc/2/notebook/security.html">Jupyter security documentation</a>.</p>';


/**
 * The mimetype used for Jupyter cell data.
 */
const JUPYTER_CELL_MIME = 'application/vnd.jupyter.cells';


/**
 * A namespace for handling actions on a notebook.
 *
 * #### Notes
 * All of the actions are a no-op if there is no model on the notebook.
 * The actions set the widget `mode` to `'command'` unless otherwise specified.
 * The actions will preserve the selection on the notebook widget unless
 * otherwise specified.
 */
export
namespace NotebookActions {
  /**
   * Split the active cell into two cells.
   *
   * @param widget - The target notebook widget.
   *
   * #### Notes
   * It will preserve the existing mode.
   * The second cell will be activated.
   * The existing selection will be cleared.
   * The leading whitespace in the second cell will be removed.
   * If there is no content, two empty cells will be created.
   * Both cells will have the same type as the original cell.
   * This action can be undone.
   */
  export
  function splitCell(widget: Notebook): void {
    if (!widget.model || !widget.activeCell) {
      return;
    }
    let state = Private.getState(widget);
    widget.deselectAll();
    let nbModel = widget.model;
    let index = widget.activeCellIndex;
    let child = widget.widgets[index];
    let editor = child.editor;
    let position = editor.getCursorPosition();
    let offset = editor.getOffsetAt(position);
    let orig = child.model.value.text;

    // Create new models to preserve history.
    let clone0 = Private.cloneCell(nbModel, child.model);
    let clone1 = Private.cloneCell(nbModel, child.model);
    if (clone0.type === 'code') {
      (clone0 as ICodeCellModel).outputs.clear();
    }
    clone0.value.text = orig.slice(0, offset).replace(/^\n+/, '').replace(/\n+$/, '');
    clone1.value.text = orig.slice(offset).replace(/^\n+/, '').replace(/\n+$/, '');

    // Make the changes while preserving history.
    let cells = nbModel.cells;
    cells.beginCompoundOperation();
    cells.set(index, clone0);
    cells.insert(index + 1, clone1);
    cells.endCompoundOperation();

    widget.activeCellIndex++;
    Private.handleState(widget, state);
  }

  /**
   * Merge the selected cells.
   *
   * @param widget - The target notebook widget.
   *
   * #### Notes
   * The widget mode will be preserved.
   * If only one cell is selected, the next cell will be selected.
   * If the active cell is a code cell, its outputs will be cleared.
   * This action can be undone.
   * The final cell will have the same type as the active cell.
   * If the active cell is a markdown cell, it will be unrendered.
   */
  export
  function mergeCells(widget: Notebook): void {
    if (!widget.model || !widget.activeCell) {
      return;
    }
    let state = Private.getState(widget);
    let toMerge: string[] = [];
    let toDelete: ICellModel[] = [];
    let model = widget.model;
    let cells = model.cells;
    let primary = widget.activeCell;
    let index = widget.activeCellIndex;

    // Get the cells to merge.
    each(widget.widgets, (child, i) => {
      if (widget.isSelected(child)) {
        toMerge.push(child.model.value.text);
        if (i !== index) {
          toDelete.push(child.model);
        }
      }
    });

    // Check for only a single cell selected.
    if (toMerge.length === 1) {
      // Bail if it is the last cell.
      if (index === cells.length - 1) {
        return;
      }
      // Otherwise merge with the next cell.
      let cellModel = cells.get(index + 1);
      toMerge.push(cellModel.value.text);
      toDelete.push(cellModel);
    }

    widget.deselectAll();

    // Create a new cell for the source to preserve history.
    let newModel = Private.cloneCell(model, primary.model);
    newModel.value.text = toMerge.join('\n\n');
    if (newModel.type === 'code') {
      (newModel as ICodeCellModel).outputs.clear();
    }

    // Make the changes while preserving history.
    cells.beginCompoundOperation();
    cells.set(index, newModel);
    each(toDelete, cell => {
      cells.removeValue(cell);
    });
    cells.endCompoundOperation();

    // If the original cell is a markdown cell, make sure
    // the new cell is unrendered.
    if (primary instanceof MarkdownCell) {
      let cell = widget.activeCell as MarkdownCell;
      cell.rendered = false;
    }

    Private.handleState(widget, state);
  }

  /**
   * Delete the selected cells.
   *
   * @param widget - The target notebook widget.
   *
   * #### Notes
   * The cell after the last selected cell will be activated.
   * It will add a code cell if all cells are deleted.
   * This action can be undone.
   */
  export
  function deleteCells(widget: Notebook): void {
    if (!widget.model || !widget.activeCell) {
      return;
    }
    let state = Private.getState(widget);
    Private.deleteCells(widget);
    Private.handleState(widget, state);
  }

  /**
   * Insert a new code cell above the active cell.
   *
   * @param widget - The target notebook widget.
   *
   * #### Notes
   * The widget mode will be preserved.
   * This action can be undone.
   * The existing selection will be cleared.
   * The new cell will the active cell.
   */
  export
  function insertAbove(widget: Notebook): void {
    if (!widget.model || !widget.activeCell) {
      return;
    }
    let state = Private.getState(widget);
    let model = widget.model;
    let cell = model.contentFactory.createCodeCell({ });
    let index = widget.activeCellIndex;
    model.cells.insert(index, cell);
    // Make the newly inserted cell active.
    widget.activeCellIndex = index;
    widget.deselectAll();
    Private.handleState(widget, state, true);
  }

  /**
   * Insert a new code cell below the active cell.
   *
   * @param widget - The target notebook widget.
   *
   * #### Notes
   * The widget mode will be preserved.
   * This action can be undone.
   * The existing selection will be cleared.
   * The new cell will be the active cell.
   */
  export
  function insertBelow(widget: Notebook): void {
    if (!widget.model || !widget.activeCell) {
      return;
    }
    let state = Private.getState(widget);
    let model = widget.model;
    let cell = model.contentFactory.createCodeCell({});
    model.cells.insert(widget.activeCellIndex + 1, cell);
    // Make the newly inserted cell active.
    widget.activeCellIndex++;
    widget.deselectAll();
    Private.handleState(widget, state, true);
  }

  /**
   * Move the selected cell(s) down.
   *
   * @param widget = The target notebook widget.
   */
  export
  function moveDown(widget: Notebook): void {
    if (!widget.model || !widget.activeCell) {
      return;
    }
    let state = Private.getState(widget);
    let cells = widget.model.cells;
    let widgets = widget.widgets;
    cells.beginCompoundOperation();
    for (let i = cells.length - 2; i > -1; i--) {
      if (widget.isSelected(widgets[i])) {
        if (!widget.isSelected(widgets[i + 1])) {
          cells.move(i, i + 1);
          if (widget.activeCellIndex === i) {
            widget.activeCellIndex++;
          }
          widget.select(widgets[i + 1]);
          widget.deselect(widgets[i]);
        }
      }
    }
    cells.endCompoundOperation();
    Private.handleState(widget, state, true);
  }

  /**
   * Move the selected cell(s) up.
   *
   * @param widget - The target notebook widget.
   */
  export
  function moveUp(widget: Notebook): void {
    if (!widget.model || !widget.activeCell) {
      return;
    }
    let state = Private.getState(widget);
    let cells = widget.model.cells;
    let widgets = widget.widgets;
    cells.beginCompoundOperation();
    for (let i = 1; i < cells.length; i++) {
      if (widget.isSelected(widgets[i])) {
        if (!widget.isSelected(widgets[i - 1])) {
          cells.move(i, i - 1);
          if (widget.activeCellIndex === i) {
            widget.activeCellIndex--;
          }
          widget.select(widgets[i - 1]);
          widget.deselect(widgets[i]);
        }
      }
    }
    cells.endCompoundOperation();
    Private.handleState(widget, state, true);
  }

  /**
   * Change the selected cell type(s).
   *
   * @param widget - The target notebook widget.
   *
   * @param value - The target cell type.
   *
   * #### Notes
   * It should preserve the widget mode.
   * This action can be undone.
   * The existing selection will be cleared.
   * Any cells converted to markdown will be unrendered.
   */
  export
  function changeCellType(widget: Notebook, value: nbformat.CellType): void {
    if (!widget.model || !widget.activeCell) {
      return;
    }
    let state = Private.getState(widget);
    Private.changeCellType(widget, value);
    Private.handleState(widget, state);
  }

  /**
   * Run the selected cell(s).
   *
   * @param widget - The target notebook widget.
   *
   * @param session - The optional client session object.
   *
   * #### Notes
   * The last selected cell will be activated, but not scrolled into view.
   * The existing selection will be cleared.
   * An execution error will prevent the remaining code cells from executing.
   * All markdown cells will be rendered.
   */
  export
  function run(widget: Notebook, session?: IClientSession): Promise<boolean> {
    if (!widget.model || !widget.activeCell) {
      return Promise.resolve(false);
    }
    let state = Private.getState(widget);
    let promise = Private.runSelected(widget, session);
    Private.handleRunState(widget, state, false);
    return promise;
  }

  /**
   * Run the selected cell(s) and advance to the next cell.
   *
   * @param widget - The target notebook widget.
   *
   * @param session - The optional client session object.
   *
   * #### Notes
   * The existing selection will be cleared.
   * The cell after the last selected cell will be activated and scrolled into view.
   * An execution error will prevent the remaining code cells from executing.
   * All markdown cells will be rendered.
   * If the last selected cell is the last cell, a new code cell
   * will be created in `'edit'` mode.  The new cell creation can be undone.
   */
  export
  function runAndAdvance(widget: Notebook, session?: IClientSession): Promise<boolean> {
    if (!widget.model || !widget.activeCell) {
      return Promise.resolve(false);
    }
    let state = Private.getState(widget);
    let promise = Private.runSelected(widget, session);
    let model = widget.model;
    if (widget.activeCellIndex === widget.widgets.length - 1) {
      let cell = model.contentFactory.createCodeCell({});
      model.cells.push(cell);
      widget.activeCellIndex++;
      widget.mode = 'edit';
    } else {
      widget.activeCellIndex++;
    }
    Private.handleRunState(widget, state, true);
    return promise;
  }

  /**
   * Run the selected cell(s) and insert a new code cell.
   *
   * @param widget - The target notebook widget.
   *
   * @param session - The optional client session object.
   *
   * #### Notes
   * An execution error will prevent the remaining code cells from executing.
   * All markdown cells will be rendered.
   * The widget mode will be set to `'edit'` after running.
   * The existing selection will be cleared.
   * The cell insert can be undone.
   * The new cell will be scrolled into view.
   */
  export
  function runAndInsert(widget: Notebook, session?: IClientSession): Promise<boolean> {
    if (!widget.model || !widget.activeCell) {
      return Promise.resolve(false);
    }
    let state = Private.getState(widget);
    let promise = Private.runSelected(widget, session);
    let model = widget.model;
    let cell = model.contentFactory.createCodeCell({});
    model.cells.insert(widget.activeCellIndex + 1, cell);
    widget.activeCellIndex++;
    widget.mode = 'edit';
    Private.handleRunState(widget, state, true);
    return promise;
  }

  /**
   * Run all of the cells in the notebook.
   *
   * @param widget - The target notebook widget.
   *
   * @param session - The optional client session object.
   *
   * #### Notes
   * The existing selection will be cleared.
   * An execution error will prevent the remaining code cells from executing.
   * All markdown cells will be rendered.
   * The last cell in the notebook will be activated and scrolled into view.
   */
  export
  function runAll(widget: Notebook, session?: IClientSession): Promise<boolean> {
    if (!widget.model || !widget.activeCell) {
      return Promise.resolve(false);
    }
    let state = Private.getState(widget);
    each(widget.widgets, child => {
      widget.select(child);
    });
    let promise = Private.runSelected(widget, session);
    Private.handleRunState(widget, state, true);
    return promise;
  }

  /**
   * Select the above the active cell.
   *
   * @param widget - The target notebook widget.
   *
   * #### Notes
   * The widget mode will be preserved.
   * This is a no-op if the first cell is the active cell.
   * The existing selection will be cleared.
   */
  export
  function selectAbove(widget: Notebook): void {
    if (!widget.model || !widget.activeCell) {
      return;
    }
    if (widget.activeCellIndex === 0) {
      return;
    }
    let state = Private.getState(widget);
    widget.activeCellIndex -= 1;
    widget.deselectAll();
    Private.handleState(widget, state, true);
  }

  /**
   * Select the cell below the active cell.
   *
   * @param widget - The target notebook widget.
   *
   * #### Notes
   * The widget mode will be preserved.
   * This is a no-op if the last cell is the active cell.
   * The existing selection will be cleared.
   */
  export
  function selectBelow(widget: Notebook): void {
    if (!widget.model || !widget.activeCell) {
      return;
    }
    if (widget.activeCellIndex === widget.widgets.length - 1) {
      return;
    }
    let state = Private.getState(widget);
    widget.activeCellIndex += 1;
    widget.deselectAll();
    Private.handleState(widget, state, true);
  }

  /**
   * Extend the selection to the cell above.
   *
   * @param widget - The target notebook widget.
   *
   * #### Notes
   * This is a no-op if the first cell is the active cell.
   * The new cell will be activated.
   */
  export
  function extendSelectionAbove(widget: Notebook): void {
    if (!widget.model || !widget.activeCell) {
      return;
    }
    // Do not wrap around.
    if (widget.activeCellIndex === 0) {
      return;
    }
    let state = Private.getState(widget);
    widget.mode = 'command';
    let current = widget.activeCell;
    let prev = widget.widgets[widget.activeCellIndex - 1];
    if (widget.isSelected(prev)) {
      widget.deselect(current);
      if (widget.activeCellIndex > 1) {
        let prevPrev = widget.widgets[widget.activeCellIndex - 2];
        if (!widget.isSelected(prevPrev)) {
          widget.deselect(prev);
        }
      }
    } else {
      widget.select(current);
    }
    widget.activeCellIndex -= 1;
    Private.handleState(widget, state, true);
  }

  /**
   * Extend the selection to the cell below.
   *
   * @param widget - The target notebook widget.
   *
   * #### Notes
   * This is a no-op if the last cell is the active cell.
   * The new cell will be activated.
   */
  export
  function extendSelectionBelow(widget: Notebook): void {
    if (!widget.model || !widget.activeCell) {
      return;
    }
    // Do not wrap around.
    if (widget.activeCellIndex === widget.widgets.length - 1) {
      return;
    }
    let state = Private.getState(widget);
    widget.mode = 'command';
    let current = widget.activeCell;
    let next = widget.widgets[widget.activeCellIndex + 1];
    if (widget.isSelected(next)) {
      widget.deselect(current);
      if (widget.activeCellIndex < widget.model.cells.length - 2) {
        let nextNext = widget.widgets[widget.activeCellIndex + 2];
        if (!widget.isSelected(nextNext)) {
          widget.deselect(next);
        }
      }
    } else {
      widget.select(current);
    }
    widget.activeCellIndex += 1;
    Private.handleState(widget, state, true);
  }

  /**
   * Copy the selected cell data to a clipboard.
   *
   * @param widget - The target notebook widget.
   */
  export
  function copy(widget: Notebook): void {
    Private.copyOrCut(widget, false);
  }

  /**
   * Cut the selected cell data to a clipboard.
   *
   * @param widget - The target notebook widget.
   *
   * #### Notes
   * This action can be undone.
   * A new code cell is added if all cells are cut.
   */
  export
  function cut(widget: Notebook): void {
    Private.copyOrCut(widget, true);
  }

  /**
   * Paste cells from the application clipboard.
   *
   * @param widget - The target notebook widget.
   *
   * #### Notes
   * The cells are pasted below the active cell.
   * The last pasted cell becomes the active cell.
   * This is a no-op if there is no cell data on the clipboard.
   * This action can be undone.
   */
  export
  function paste(widget: Notebook): void {
    if (!widget.model || !widget.activeCell) {
      return;
    }
    let clipboard = Clipboard.getInstance();
    if (!clipboard.hasData(JUPYTER_CELL_MIME)) {
      return;
    }
    let state = Private.getState(widget);
    let values = clipboard.getData(JUPYTER_CELL_MIME) as nbformat.IBaseCell[];
    let model = widget.model;
    let newCells: ICellModel[] = [];
    widget.mode = 'command';

    each(values, cell => {
      switch (cell.cell_type) {
      case 'code':
        newCells.push(model.contentFactory.createCodeCell({ cell }));
        break;
      case 'markdown':
        newCells.push(model.contentFactory.createMarkdownCell({ cell }));
        break;
      default:
        newCells.push(model.contentFactory.createRawCell({ cell }));
        break;
      }
    });
    let index = widget.activeCellIndex;

    let cells = widget.model.cells;
    cells.beginCompoundOperation();
    each(newCells, cell => {
      cells.insert(++index, cell);
    });
    cells.endCompoundOperation();

    widget.activeCellIndex += newCells.length;
    widget.deselectAll();
    Private.handleState(widget, state);
  }

  /**
   * Undo a cell action.
   *
   * @param widget - The target notebook widget.
   *
   * #### Notes
   * This is a no-op if if there are no cell actions to undo.
   */
  export
  function undo(widget: Notebook): void {
    if (!widget.model || !widget.activeCell) {
      return;
    }
    let state = Private.getState(widget);
    widget.mode = 'command';
    widget.model.cells.undo();
    widget.deselectAll();
    Private.handleState(widget, state);
  }

  /**
   * Redo a cell action.
   *
   * @param widget - The target notebook widget.
   *
   * #### Notes
   * This is a no-op if there are no cell actions to redo.
   */
  export
  function redo(widget: Notebook): void {
    if (!widget.model || !widget.activeCell) {
      return;
    }
    let state = Private.getState(widget);
    widget.mode = 'command';
    widget.model.cells.redo();
    widget.deselectAll();
    Private.handleState(widget, state);
  }

  /**
   * Toggle line numbers on the selected cell(s).
   *
   * @param widget - The target notebook widget.
   *
   * #### Notes
   * The original state is based on the state of the active cell.
   * The `mode` of the widget will be preserved.
   */
  export
  function toggleLineNumbers(widget: Notebook): void {
    if (!widget.model || !widget.activeCell) {
      return;
    }
    let state = Private.getState(widget);
    let lineNumbers = widget.activeCell.editor.getOption('lineNumbers');
    each(widget.widgets, child => {
      if (widget.isSelected(child)) {
        child.editor.setOption('lineNumbers', !lineNumbers);
      }
    });
    Private.handleState(widget, state);
  }

  /**
   * Toggle the line number of all cells.
   *
   * @param widget - The target notebook widget.
   *
   * #### Notes
   * The original state is based on the state of the active cell.
   * The `mode` of the widget will be preserved.
   */
  export
  function toggleAllLineNumbers(widget: Notebook): void {
    if (!widget.model || !widget.activeCell) {
      return;
    }
    let state = Private.getState(widget);
    let lineNumbers = widget.activeCell.editor.getOption('lineNumbers');
    each(widget.widgets, child => {
      child.editor.setOption('lineNumbers', !lineNumbers);
    });
    Private.handleState(widget, state);
  }

  /**
   * Clear the code outputs of the selected cells.
   *
   * @param widget - The target notebook widget.
   *
   * #### Notes
   * The widget `mode` will be preserved.
   */
  export
  function clearOutputs(widget: Notebook): void {
    if (!widget.model || !widget.activeCell) {
      return;
    }
    let state = Private.getState(widget);
    let cells = widget.model.cells;
    let i = 0;
    each(cells, (cell: ICodeCellModel) => {
      let child = widget.widgets[i];
      if (widget.isSelected(child) && cell.type === 'code') {
        cell.outputs.clear();
        (child as CodeCell).outputHidden = false;
        cell.executionCount = null;
      }
      i++;
    });
    Private.handleState(widget, state);
  }

  /**
   * Clear all the code outputs on the widget.
   *
   * @param widget - The target notebook widget.
   *
   * #### Notes
   * The widget `mode` will be preserved.
   */
  export
  function clearAllOutputs(widget: Notebook): void {
    if (!widget.model || !widget.activeCell) {
      return;
    }
    let state = Private.getState(widget);
    let i = 0;
    each(widget.model.cells, (cell: ICodeCellModel) => {
      let child = widget.widgets[i];
      if (cell.type === 'code') {
        cell.outputs.clear();
        cell.executionCount = null;
        (child as CodeCell).outputHidden = false;
      }
      i++;
    });
    Private.handleState(widget, state);
  }

  /**
   * Hide the code on selected code cells.
   *
   * @param widget - The target notebook widget.
   */
  export
  function hideCode(widget: Notebook): void {
    if (!widget.model || !widget.activeCell) {
      return;
    }
    let state = Private.getState(widget);
    let cells = widget.widgets;
    each(cells, (cell: Cell) => {
      if (widget.isSelected(cell) && cell.model.type === 'code') {
        cell.inputHidden = true;
      }
    });
    Private.handleState(widget, state);
  }

  /**
   * Show the code on selected code cells.
   *
   * @param widget - The target notebook widget.
   */
  export
  function showCode(widget: Notebook): void {
    if (!widget.model || !widget.activeCell) {
      return;
    }
    let state = Private.getState(widget);
    let cells = widget.widgets;
    each(cells, (cell: Cell) => {
      if (widget.isSelected(cell) && cell.model.type === 'code') {
        cell.inputHidden = false;
      }
    });
    Private.handleState(widget, state);
  }

  /**
   * Hide the code on all code cells.
   *
   * @param widget - The target notebook widget.
   */
  export
  function hideAllCode(widget: Notebook): void {
    if (!widget.model || !widget.activeCell) {
      return;
    }
    let state = Private.getState(widget);
    let cells = widget.widgets;
    each(cells, (cell: Cell) => {
      if (cell.model.type === 'code') {
        cell.inputHidden = true;
      }
    });
    Private.handleState(widget, state);
  }

  /**
   * Show the code on all code cells.
   *
   * @param widget - The target notebook widget.
   */
  export
  function showAllCode(widget: Notebook): void {
    if (!widget.model || !widget.activeCell) {
      return;
    }
    let state = Private.getState(widget);
    let cells = widget.widgets;
    each(cells, (cell: Cell) => {
      if (cell.model.type === 'code') {
        cell.inputHidden = false;
      }
    });
    Private.handleState(widget, state);
  }

  /**
   * Hide the output on selected code cells.
   *
   * @param widget - The target notebook widget.
   */
  export
  function hideOutput(widget: Notebook): void {
    if (!widget.model || !widget.activeCell) {
      return;
    }
    let state = Private.getState(widget);
    let cells = widget.widgets;
    each(cells, (cell: Cell) => {
      if (widget.isSelected(cell) && cell.model.type === 'code') {
        (cell as CodeCell).inputHidden = true;
      }
    });
    Private.handleState(widget, state);
  }

  /**
   * Show the output on selected code cells.
   *
   * @param widget - The target notebook widget.
   */
  export
  function showOutput(widget: Notebook): void {
    if (!widget.model || !widget.activeCell) {
      return;
    }
    let state = Private.getState(widget);
    let cells = widget.widgets;
    each(cells, (cell: Cell) => {
      if (widget.isSelected(cell) && cell.model.type === 'code') {
        (cell as CodeCell).inputHidden = false;
      }
    });
    Private.handleState(widget, state);
  }

  /**
   * Hide the output on all code cells.
   *
   * @param widget - The target notebook widget.
   */
  export
  function hideAllOutputs(widget: Notebook): void {
    if (!widget.model || !widget.activeCell) {
      return;
    }
    let state = Private.getState(widget);
    let cells = widget.widgets;
    each(cells, (cell: Cell) => {
      if (cell.model.type === 'code') {
        (cell as CodeCell).outputHidden = true;
      }
    });
    Private.handleState(widget, state);
  }

  /**
   * Show the output on all code cells.
   *
   * @param widget - The target notebook widget.
   */
  export
  function showAllOutputs(widget: Notebook): void {
    if (!widget.model || !widget.activeCell) {
      return;
    }
    let state = Private.getState(widget);
    let cells = widget.widgets;
    each(cells, (cell: Cell) => {
      if (cell.model.type === 'code') {
        (cell as CodeCell).outputHidden = false;
      }
    });
    Private.handleState(widget, state);
  }

  /**
   * Set the markdown header level.
   *
   * @param widget - The target notebook widget.
   *
   * @param level - The header level.
   *
   * #### Notes
   * All selected cells will be switched to markdown.
   * The level will be clamped between 1 and 6.
   * If there is an existing header, it will be replaced.
   * There will always be one blank space after the header.
   * The cells will be unrendered.
   */
  export
  function setMarkdownHeader(widget: Notebook, level: number) {
    if (!widget.model || !widget.activeCell) {
      return;
    }
    let state = Private.getState(widget);
    level = Math.min(Math.max(level, 1), 6);
    let cells = widget.model.cells;
    let i = 0;
    each(widget.widgets, (child: MarkdownCell) => {
      if (widget.isSelected(child)) {
        Private.setMarkdownHeader(cells.get(i), level);
      }
      i++;
    });
    Private.changeCellType(widget, 'markdown');
    Private.handleState(widget, state);
  }

  /**
   * Trust the notebook after prompting the user.
   *
   * @param widget - The target notebook widget.
   *
   * @returns a promise that resolves when the transaction is finished.
   *
   * #### Notes
   * No dialog will be presented if the notebook is already trusted.
   */
  export
  function trust(widget: Notebook): Promise<void> {
    if (!widget.model) {
      return Promise.resolve(void 0);
    }
    // Do nothing if already trusted.
    let cells = widget.model.cells;
    let trusted = true;
    for (let i = 0; i < cells.length; i++) {
      let cell = cells.get(i);
      if (!cell.trusted) {
        trusted = false;
      }
    }
    if (trusted) {
      return showDialog({
        body: 'Notebook is already trusted',
        buttons: [Dialog.okButton()]
      }).then(() => void 0);
    }
    let body = document.createElement('div');
    body.innerHTML = TRUST_MESSAGE;
    return showDialog({
      body,
      title: 'Trust this notebook?',
      buttons: [Dialog.cancelButton(), Dialog.warnButton()]
    }).then(result => {
      if (result.accept) {
        for (let i = 0; i < cells.length; i++) {
          let cell = cells.get(i);
          cell.trusted = true;
        }
      }
    });
  }
}


/**
 * A namespace for private data.
 */
namespace Private {
  /**
   * The interface for a widget state.
   */
  export
  interface IState {
    /**
     * Whether the widget had focus.
     */
    wasFocused: boolean;

    /**
     * The active cell before the action.
     */
    activeCell: Cell;
  }

  /**
   * Get the state of a widget before running an action.
   */
  export
  function getState(widget: Notebook): IState {
    return {
      wasFocused: widget.node.contains(document.activeElement),
      activeCell: widget.activeCell
    };
  }

  /**
   * Handle the state of a widget after running an action.
   */
  export
  function handleState(widget: Notebook, state: IState, scrollIfNeeded=false): void {
    if (state.wasFocused || widget.mode === 'edit') {
      widget.activate();
    }
    if (scrollIfNeeded) {
      ElementExt.scrollIntoViewIfNeeded(widget.node, widget.activeCell.node);
    }
  }

  /**
   * Handle the state of a widget after running a run action.
   */
  export
  function handleRunState(widget: Notebook, state: IState, scroll = false): void {
    if (state.wasFocused || widget.mode === 'edit') {
      widget.activate();
    }
    if (scroll) {
      // Scroll to the top of the previous active cell output.
      let er = state.activeCell.inputArea.node.getBoundingClientRect();
      widget.scrollToPosition(er.bottom);
    }
  }

  /**
   * Clone a cell model.
   */
  export
  function cloneCell(model: INotebookModel, cell: ICellModel): ICellModel {
    switch (cell.type) {
    case 'code':
      // TODO why isnt modeldb or id passed here?
      return model.contentFactory.createCodeCell({ cell: cell.toJSON() });
    case 'markdown':
      // TODO why isnt modeldb or id passed here?
      return model.contentFactory.createMarkdownCell({ cell: cell.toJSON() });
    default:
      // TODO why isnt modeldb or id passed here?
      return model.contentFactory.createRawCell({ cell: cell.toJSON() });
    }
  }

  /**
   * Run the selected cells.
   */
  export
  function runSelected(widget: Notebook, session?: IClientSession): Promise<boolean> {
    widget.mode = 'command';
    let selected: Cell[] = [];
    let lastIndex = widget.activeCellIndex;
    let i = 0;
    each(widget.widgets, child => {
      if (widget.isSelected(child)) {
        selected.push(child);
        lastIndex = i;
      }
      i++;
    });
    widget.activeCellIndex = lastIndex;
    widget.deselectAll();

    let promises: Promise<boolean>[] = [];
    each(selected, child => {
      promises.push(runCell(widget, child, session));
    });
    return Promise.all(promises).then(results => {
      if (widget.isDisposed) {
        return false;
      }
      // Post an update request.
      widget.update();
      for (let result of results) {
        if (!result) {
          return false;
        }
      }
      return true;
    });
  }

  /**
   * Run a cell.
   */
  function runCell(parent: Notebook, child: Cell, session?: IClientSession): Promise<boolean> {
    switch (child.model.type) {
    case 'markdown':
      (child as MarkdownCell).rendered = true;
      child.inputHidden = false;
      break;
    case 'code':
      if (session) {
        return CodeCell.execute(child as CodeCell, session).then(reply => {
          if (child.isDisposed) {
            return false;
          }
          if (reply && reply.content.status === 'ok') {
            let content = reply.content as KernelMessage.IExecuteOkReply;
            if (content.payload && content.payload.length) {
              handlePayload(content, parent, child);
            }
          }
          return reply ? reply.content.status === 'ok' : true;
        });
      }
      (child.model as ICodeCellModel).executionCount = null;
      break;
    default:
      break;
    }
    return Promise.resolve(true);
  }

  /**
   * Handle payloads from an execute reply.
   *
   * #### Notes
   * Payloads are deprecated and there are no official interfaces for them in
   * the kernel type definitions.
   * See [Payloads (DEPRECATED)](https://jupyter-client.readthedocs.io/en/latest/messaging.html#payloads-deprecated).
   */
  function handlePayload(content: KernelMessage.IExecuteOkReply, parent: Notebook, child: Cell) {
    let setNextInput = content.payload.filter(i => {
      return (i as any).source === 'set_next_input';
    })[0];

    if (!setNextInput) {
      return;
    }

    let text = (setNextInput as any).text;
    let replace = (setNextInput as any).replace;

    if (replace) {
      child.model.value.text = text;
      return;
    }

    // Create a new code cell and add as the next cell.
    let cell = parent.model.contentFactory.createCodeCell({});
    cell.value.text = text;
    let cells = parent.model.cells;
    let i = ArrayExt.firstIndexOf(toArray(cells), child.model);
    if (i === -1) {
      cells.push(cell);
    } else {
      cells.insert(i + 1, cell);
    }
  }

  /**
   * Copy or cut the selected cell data to the application clipboard.
   *
   * @param widget - The target notebook widget.
   *
   * @param cut - Whether to copy or cut.
   */
   export
   function copyOrCut(widget: Notebook, cut: boolean): void {
     if (!widget.model || !widget.activeCell) {
       return;
     }
     let state = getState(widget);
     widget.mode = 'command';
     let clipboard = Clipboard.getInstance();
     clipboard.clear();
     let data: nbformat.IBaseCell[] = [];
     each(widget.widgets, child => {
       if (widget.isSelected(child)) {
         data.push(child.model.toJSON());
       }
     });
     clipboard.setData(JUPYTER_CELL_MIME, data);
     if (cut) {
       deleteCells(widget);
     } else {
       widget.deselectAll();
     }
     handleState(widget, state);
   }

  /**
   * Change the selected cell type(s).
   *
   * @param widget - The target notebook widget.
   *
   * @param value - The target cell type.
   *
   * #### Notes
   * It should preserve the widget mode.
   * This action can be undone.
   * The existing selection will be cleared.
   * Any cells converted to markdown will be unrendered.
   */
  export
  function changeCellType(widget: Notebook, value: nbformat.CellType): void {
    let model = widget.model;
    let cells = model.cells;

    cells.beginCompoundOperation();
    each(widget.widgets, (child, i) => {
      if (!widget.isSelected(child)) {
        return;
      }
      if (child.model.type !== value) {
        let cell: nbformat.IBaseCell = child.model.toJSON();
        let newCell: ICellModel;
        switch (value) {
        case 'code':
          newCell = model.contentFactory.createCodeCell({ cell });
          break;
        case 'markdown':
          newCell = model.contentFactory.createMarkdownCell({ cell });
          if (child.model.type === 'code') {
            newCell.trusted = false;
          }
          break;
        default:
          newCell = model.contentFactory.createRawCell({ cell });
          if (child.model.type === 'code') {
            newCell.trusted = false;
          }
        }
        cells.set(i, newCell);
      }
      if (value === 'markdown') {
        // Fetch the new widget and unrender it.
        child = widget.widgets[i];
        (child as MarkdownCell).rendered = false;
      }
    });
    cells.endCompoundOperation();
    widget.deselectAll();
  }

  /**
   * Delete the selected cells.
   *
   * @param widget - The target notebook widget.
   *
   * #### Notes
   * The cell after the last selected cell will be activated.
   * It will add a code cell if all cells are deleted.
   * This action can be undone.
   */
  export
  function deleteCells(widget: Notebook): void {
    let model = widget.model;
    let cells = model.cells;
    let toDelete: number[] = [];
    widget.mode = 'command';

    // Find the cells to delete.
    each(widget.widgets, (child, i) => {
      let deletable = child.model.metadata.get('deletable');
      if (widget.isSelected(child) && deletable !== false) {
        toDelete.push(i);
      }
    });

    // If cells are not deletable, we may not have anything to delete.
    if (toDelete.length > 0) {
      // Delete the cells as one undo event.
      cells.beginCompoundOperation();
      each(toDelete.reverse(), i => {
        cells.remove(i);
      });
      // Add a new cell if the notebook is empty. This is done
      // within the compound operation to make the deletion of
      // a notebook's last cell undoable.
      if (!cells.length) {
        cells.push(model.contentFactory.createCodeCell({}));
      }
      cells.endCompoundOperation();

      // Select the *first* interior cell not deleted or the cell
      // *after* the last selected cell.
      // Note: The activeCellIndex is clamped to the available cells,
      // so if the last cell is deleted the previous cell will be activated.
      widget.activeCellIndex = toDelete[0];
    }

    // Deselect any remaining, undeletable cells. Do this even if we don't
    // delete anything so that users are aware *something* happened.
    widget.deselectAll();
  }

  /**
   * Set the markdown header level of a cell.
   */
  export
  function setMarkdownHeader(cell: ICellModel, level: number) {
    let source = cell.value.text;
    let newHeader = Array(level + 1).join('#') + ' ';
    // Remove existing header or leading white space.
    let regex = /^(#+\s*)|^(\s*)/;
    let matches = regex.exec(source);
    if (matches) {
      source = source.slice(matches[0].length);
    }
    cell.value.text = newHeader + source;
  }
}
