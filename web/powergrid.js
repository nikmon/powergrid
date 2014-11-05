define(['jquery', 'vein', 'utils', 'promise'], function($, vein, utils, Promise) {
    "use strict";

    var defaultOptions = {
        virtualScrollingExcess: 30, // defines the number of extra rows to render on each side (top/bottom) of the viewport. This reduces flickering when scrolling.
        frozenRowsTop: 0,
        frozenRowsBottom: 0,
        frozenColumnsLeft: 0,
        frozenColumnsRight: 0,
        fullWidth: true
    };

    function determineScrollBarSize() {
        // Creates a dummy div just to measure the scrollbar sizes, then deletes it when it's no longer necessary.
        var dummy = $("<div style='overflow: scroll; width: 100px; height: 100px; visibility: none; opacity: 0'></div>");
        var filler = $("<div style='width:100%; height: 100%;'></div>");
        dummy.append(filler);
        $('body').append(dummy);

        var size = {
            height: dummy.height() - filler.height(),
            width: dummy.width() - filler.width()
        };

        dummy.remove();

        return size;
    }

    var scrollBarSize;

    $(function() {
        scrollBarSize = determineScrollBarSize();

        //adjust the margin to compensate for the scrollbar
        vein.inject('.pg-rowgroup', {'width': "calc(100% - " + scrollBarSize.width + "px)"});
        vein.inject('.pg-rowgroup.pg-footer', {'bottom': scrollBarSize.width + "px"});
    });

    function PowerGrid(target, options) {
        var grid = this;
        this.options = options;
        this.target = target;

        for(var x in defaultOptions) {
            if(this.options[x] === undefined) {
                this.options[x] = defaultOptions[x];
            }
        }

        this.dataSource = options.dataSource;

        if(target === false) return;
        
        this.promise = new Promise(function(resolve, reject) {
            grid.beginInit(resolve);
        });
        
        $(target).on('remove', function() { 
        	grid.destroy();
        	}
        );
        this.id = target.attr('id');
    }

    PowerGrid.prototype = {
        then: function(cb) {
            return this.promise.then(cb);
        },
        
        beginInit: function(callback) {
            var grid = this;
            
            if(!this.dataSource.isReady()) {
                this.initLoadingIndicator();
            }

            if(this.options.extensions) {
                this.loadExtensions(function(pluginList, plugins) {
                    pluginList = grid.sortByLoadOrder(pluginList, plugins);

                    pluginList.forEach(function(key) {
                        console.info("Initing extension " + key);
                        var p = plugins[key];
                        if(typeof p === 'function') {
                            p(grid, grid.options.extensions[key]);
                        } else if(typeof p.init === 'function') {
                            p.init(grid, grid.options.extensions[key]);
                        }
                    });

                    grid.init();
                    callback();
                });
            } else {
                grid.init();
                callback();
            }
        },
        
        loadExtensions: function(callback, keys, plugins, pluginList) {
            var grid = this;
            if(arguments.length < 4) {
                keys = Object.keys(this.options.extensions),
                plugins = {};
                pluginList = [];
            }
            var files = keys.map(function(e) { return "extensions/" + e; });
            require(files, function() {
                var newkeys = [];
                for(var x = 0; x < arguments.length; x++) {
                    plugins[keys[x]] = arguments[x];
                    pluginList.push(keys[x]);

                    var reqs = arguments[x].requires;
                    if(reqs) {
                        for(var req in reqs) {
                            if(!grid.options.extensions[req]) {
                                newkeys.push(req);
                            }

                            if(grid.options.extensions[req]) {
                                $.extend(grid.options.extensions[req], reqs[req]);
                            } else {
                                grid.options.extensions[req] = reqs[req];
                            }
                        }
                    }
                }

                if(newkeys.length) {
                    grid.loadExtensions(callback, newkeys, plugins, pluginList);
                } else {
                    callback(pluginList, plugins);
                }
            });
        },
        
        sortByLoadOrder: function(pluginList, plugins) {
            var sorted = [], added = {};
            
            function add(key) {
                if(plugins[key] !== undefined && added[key] === undefined) {
                    if(plugins[key].loadFirst) {
                        plugins[key].loadFirst.forEach(add);
                    }
                    sorted.push(key);
                    added[key] = true;
                }
            }
            
            pluginList.forEach(add);
            
            return sorted;
        },

        initLoadingIndicator: function () {
            var grid = this;
            $(this.container).addClass('pg-loading');
            $(this.dataSource).on("dataloaded", function(event) {
                $(grid.container).removeClass('pg-loading');
            })
        },

        init: function init() {
            var grid = this;
            var baseSelector = this.baseSelector = "#" + this.target.attr('id'),

                container = this.container = $("<div class='powergrid'>"),
                columnheadercontainer = this.columnheadercontainer = $("<div class='pg-columnheaders'>"),
                headercontainer = this.headercontainer = this.options.frozenRowsTop && $("<div class='pg-rowgroup pg-header'>") || undefined,
                scrollingcontainer = this.scrollingcontainer = $("<div class='pg-rowgroup pg-scrolling'>"),
                footercontainer = this.footercontainer = this.options.frozenRowsBottom && $("<div class='pg-rowgroup pg-footer'>") || undefined,
                scroller = this.scroller = $("<div class='pg-scroller'>"),
                scrollFiller = this.scrollFiller = $("<div class='pg-scroller-filler'>"),

                scrollContainers = this.scrollContainers = ($().add(scrollingcontainer).add(headercontainer).add(footercontainer));

            if(this.options.fullWidth) {
                container.addClass("pg-full-width");
            }
            
            if(this.options.autoResize) {
                container.addClass("pg-autoresize");
            }
            
            this.options.columns.forEach(function(column, index) {
                if(column.key === undefined) {
                    column.key = index;
                }
            });

            this.fixedLeft = this.fixedRight = this.middleScrollers = $();

            this.columnheadergroup = this.createRowGroup(columnheadercontainer);
            this.headergroup = headercontainer && this.createRowGroup(headercontainer);
            this.scrollinggroup = this.createRowGroup(scrollingcontainer, false);
            this.footergroup = footercontainer && this.createRowGroup(footercontainer);
            
            this.renderColumnHeaderContents(this.columnheadergroup);

            container.append(columnheadercontainer).append(headercontainer).append(scrollingcontainer).append(footercontainer).append(scroller.append(scrollFiller));

            this.adjustWidths();
            this.adjustColumnPositions();

            $(this.target).append(container);

            scroller.on('scroll', function(evt) {
                grid.syncScroll(this, evt);
            });

            if(this.dataSource.isReady()) {
                grid.trigger('dataloaded');
                requestAnimationFrame(function() {
                    grid.renderData();
                    grid.trigger('viewchanged');
                });
            }

            $(this.dataSource).on("dataloaded", function(event) {
                grid.trigger('dataloaded', event.data);
                requestAnimationFrame(function() {
                    grid.renderData();
                    grid.trigger('viewchanged');
                });
            }).on("rowsremoved", function(event, data) {
                requestAnimationFrame(function() {
                    grid._removeRows(data.start, data.end);
                    grid.trigger('rowsremoved', data);
                    grid.trigger('viewchanged');
                });
            }).on("rowsadded", function(event, data) {
                requestAnimationFrame(function() {
                    grid._addRows(data.start, data.end);
                    grid.trigger('rowsadded', data);
                    grid.trigger('viewchanged');
                });
            }).on("datachanged", function(event, data) {
                requestAnimationFrame(function() {
                    if(data.data) {
                        grid._dataChanged(data.data, data.oldData);
                    }
                    if(data.values) {
                        grid.updateCellValues(data.values);
                        grid.trigger('change');
                    }
                    grid.trigger('datachanged', data);
                    grid.trigger('viewchanged');
                });
            });

            this.initScrollEvents();
        },
        
        destroy: function() {
            this.target.empty();
        },

        initScrollEvents: function initScrollEvents() {
            var self = this;
            this.target.on("wheel", function(evt) {
                var dX = evt.originalEvent.deltaX, dY = evt.originalEvent.deltaY, dM = evt.originalEvent.deltaMode, ddX, ddY;
                switch(dM) {
                    case 0: ddX=ddY=1; break;
                    case 1: ddX=ddY=self.rowHeight(0); break;
                    case 2: ddX=self.pageHeight(); ddY=self.pageWidth(); break;
                }

                self.scrollBy(dX * ddX, dY * ddY);
            });

            this.initTouchScrollEvents();
        },

        initTouchScrollEvents: function() {
            // sets up touch scrolling
            var self = this,
                tracking = false, // keep tracking of whether we're currently tracking touch or not
                lastX, lastY,
                timeUnit = 100, // 100ms
                inertialCutOff = 0.001, // minimum speed for inertial scrolling before cutoff
                inertia = 0.998, // inertia for inertial scrolling (higher means longer scrolling, 1 = infinite (frictionless) scrolling, 0 = no inertial scrolling)
                // scroll speed is multiplied by this factor for each millisecond that passes

                eventQueue = []; // keep track of last 100ms of events to determine drag speed

            function pruneEventQueue() {
                // remove all eventQueue entries older than <timeUnit> milliseconds
                var t = eventQueue[0].t;
                for(var x=1,l=eventQueue.length;x<l;x++) {
                    if( (t - eventQueue[x].t) > timeUnit ) break;
                }
                eventQueue = eventQueue.slice(0, x);
            }

            function startInertialScroll(speedX, speedY) {
                var previousTime = new Date().getTime();

                var scrollPosition = self.getScrollPosition();

                function draw() {
                    if(tracking) return; // if tracking a new touch thing, stop inertial scrolling

                    var t = new Date().getTime();
                    var frameDuration = t - previousTime;
                    previousTime = t;

                    var r = Math.pow(inertia, frameDuration);
                    speedX = speedX * r; // adjust speed according to drag
                    speedY = speedY * r;

                    if(Math.abs(speedX) >= inertialCutOff && Math.abs(speedY) >= inertialCutOff) {
                        // not doing relative scrolling because that looses a lot of precision
                        scrollPosition.left += speedX * frameDuration;
                        scrollPosition.top += speedY * frameDuration;
                        self.scrollTo(Math.round(scrollPosition.left), Math.round(scrollPosition.top));

                        // request next frame.
                        requestAnimationFrame(draw);
                    }
                };

                requestAnimationFrame(draw);   
            }

            this.target.on("touchstart", function(startevent) {
                // user touches screen, so we may have to start scrolling
                tracking = true;
                lastX = startevent.originalEvent.touches[0].pageX, lastY = startevent.originalEvent.touches[0].pageY;
            }).on("touchmove", function(dragevent) {
                if(tracking) { // probably a pointless test since we shouldn't be getting a touchmove event unless we got a touchstart first anyway, but still
                    var newX = dragevent.originalEvent.touches[0].pageX, newY = dragevent.originalEvent.touches[0].pageY;

                    var dX = lastX - newX, dY = lastY - newY;

                    var e = {
                        x: dX,
                        y: dY,
                        t: new Date().getTime()
                    };

                    eventQueue.unshift(e);
                    pruneEventQueue();

                    lastX = newX;
                    lastY = newY;

                    self.scrollBy(dX, dY);

                    dragevent.preventDefault();
                }
            }).on("touchend", function(endevent) {
                tracking = false;

                if(!eventQueue.length) return;

                var timeSinceLastEvent = (new Date().getTime()) - eventQueue[0].t;
                if(timeSinceLastEvent < timeUnit) {
                    var delta = eventQueue.reduce(function(a,b) {
                        a.dX += b.x;
                        a.dY += b.y;
                        return a;
                    }, { dX: 0, dY: 0 });

                    var timeBetween = eventQueue[0].t - eventQueue[eventQueue.length-1].t;

                    startInertialScroll(delta.dX / timeBetween, delta.dY / timeBetween);
                }

                eventQueue = [];
            });
        },
        
        createRowGroup: function createRowGroup(container, adddummies) {
            var fixedPartLeft = this.options.frozenColumnsLeft > 0 && $("<div class='pg-container pg-fixed pg-left'>");
            var fixedPartRight = this.options.frozenColumnsRight > 0 && $("<div class='pg-container pg-fixed pg-right'>");
            var scrollingPart = $("<div class='pg-container pg-scrolling'>");

            this.fixedLeft = this.fixedLeft.add(fixedPartLeft);
            this.fixedRight = this.fixedRight.add(fixedPartRight);
            this.middleScrollers = this.middleScrollers.add(scrollingPart);

            var self = this;

            if(adddummies) {
                fixedPartLeft.add(scrollingPart).add(fixedPartRight).each(function(i, part) {
                    $(part).append("<div class='.pg-dummyLead'>").append("<div class='.pg-dummyTail'>");
                });
            }

            container.append(fixedPartLeft).append(scrollingPart).append(fixedPartRight);

            var all = $();
            if(fixedPartLeft) all = all.add(fixedPartLeft);
            if(scrollingPart) all = all.add(scrollingPart);
            if(fixedPartRight) all = all.add(fixedPartRight);

            return {
                left: fixedPartLeft,
                scrolling: scrollingPart,
                right: fixedPartRight,
                all: all
            };
        },

        renderData: function() {
            this.headergroup && this.headergroup.all.empty();
            this.footergroup && this.footergroup.all.empty();
            this.scrollinggroup.all.empty();

            this.viewport = {
                begin: 0,
                end: 0
            };

            this.headergroup && this.renderRowGroupContents(0, this.options.frozenRowsTop, this.headergroup);
            this.footergroup && this.renderRowGroupContents(this.dataSource.recordCount() - this.options.frozenRowsBottom, this.dataSource.recordCount(), this.footergroup);
            this.updateViewport();
            this.adjustHeights();
            this.syncScroll();
            this.trigger("datarendered");
        },
        
        renderColumnHeaderContents: function(rowgroup) {
            var rowFixedPartLeft = rowgroup.left && $("<div class='pg-row pg-fixed'>"),
                rowScrollingPart = rowgroup.scrolling && $("<div class='pg-row pg-scrolling'>"),
                rowFixedPartRight = rowgroup.right && $("<div class='pg-row pg-fixed'>"),
                rowParts = $();
            
            if(rowgroup.left) rowgroup.left.append(rowFixedPartLeft);
            if(rowgroup.scrolling) rowgroup.scrolling.append(rowScrollingPart);
            if(rowgroup.right) rowgroup.right.append(rowFixedPartRight);
            
            if(rowFixedPartLeft) rowParts = rowParts.add(rowFixedPartLeft);
            if(rowScrollingPart) rowParts = rowParts.add(rowScrollingPart);
            if(rowFixedPartRight) rowParts = rowParts.add(rowFixedPartRight);
            
            for(var y = 0; y < this.options.columns.length; y++) {
                var cell, column = this.options.columns[y];
                cell = this.renderHeaderCell(column, y);

                cell.addClass("pg-column" + column.key);
                cell.attr("data-column-key", column.key);

                if(y < this.options.frozenColumnsLeft) {
                    rowFixedPartLeft.append(cell);
                } else if(y > this.options.columns.length - this.options.frozenColumnsRight - 1) {
                    rowFixedPartRight.append(cell);
                } else {
                    rowScrollingPart.append(cell);
                }
            }
        },

        renderRowGroupContents: function(start, end, rowgroup, prepend, atIndex) {
            if(atIndex == -1 && !prepend) {
                // we're inserting a row after -1, so basically prepend before anything else
                atIndex = undefined;
                prepend = true;
            }
            
            var method = atIndex === undefined ? (prepend === true ? 'prepend' : 'append') : (prepend === true ? 'before' : 'after');

            var reverse = prepend ^ (atIndex !== undefined);

            var targetLeft, targetMiddle, targetRight;

            if(atIndex === undefined) {
                targetLeft = rowgroup.left;
                targetMiddle = rowgroup.scrolling;
                targetRight = rowgroup.right;
            } else {
                targetLeft = rowgroup.left && rowgroup.left.children(".pg-row:eq(" + atIndex + ")");
                targetMiddle = rowgroup.scrolling && rowgroup.scrolling.children(".pg-row:eq(" + atIndex + ")");
                targetRight = rowgroup.right && rowgroup.right.children(".pg-row:eq(" + atIndex + ")");
            }

            var dataSubset = this.dataSource.getData(start<0?0:start, end);

            for(var x = reverse ? end - 1 : start; reverse ? x >= start : x < end; reverse ? x-- : x++) {
                var rowFixedPartLeft = targetLeft && $("<div class='pg-row pg-fixed'>");
                var rowScrollingPart = targetMiddle && $("<div class='pg-row pg-scrolling'>");
                var rowFixedPartRight = targetRight && $("<div class='pg-row pg-fixed'>");

                var rowParts = $();
                if(rowFixedPartLeft) rowParts = rowParts.add(rowFixedPartLeft);
                if(rowScrollingPart) rowParts = rowParts.add(rowScrollingPart);
                if(rowFixedPartRight) rowParts = rowParts.add(rowFixedPartRight);

                var record = dataSubset[x-start];
                rowParts.attr("data-row-idx", x).attr("data-row-id", record.id);

                this.renderRowToParts(record, x, rowFixedPartLeft, rowScrollingPart, rowFixedPartRight);

                this.afterRenderRow(record, x, rowParts);

                $(rowParts).css('height', this.rowHeight(x) + "px");

                if(targetLeft) targetLeft[method](rowFixedPartLeft);
                if(targetMiddle) targetMiddle[method](rowScrollingPart);
                if(targetRight) targetRight[method](rowFixedPartRight);
            }
        },
        
        renderRowToParts: function(record, rowIdx, rowFixedPartLeft, rowScrollingPart, rowFixedPartRight) {
            for(var y = 0; y < this.options.columns.length; y++) {
                var cell, column = this.options.columns[y];
                cell = this.renderCell(record, column, rowIdx, y);
                this.afterCellRendered(record, column, cell);
                
                cell.addClass("pg-column" + column.key);
                cell.attr("data-column-key", column.key);

                if(y < this.options.frozenColumnsLeft) {
                    rowFixedPartLeft.append(cell);
                } else if(y > this.options.columns.length - this.options.frozenColumnsRight - 1) {
                    rowFixedPartRight.append(cell);
                } else {
                    rowScrollingPart.append(cell);
                }
            }
        },

        afterRenderRow: function(record, rowIndex, rowParts) {
        },

        _removeRows: function(start, end) {
            console.log("Removing rows" +start + " to " + end);
            function r(start, end, rowgroup) {
                var selector = ".pg-row:lt(" + end + ")";
                if(start > 0) {
                    selector += ":gt(" + (start-1) + ")";
                }
                rowgroup.children(".pg-container").each(function(i,part) {
                    $(part).children(selector).remove();
                });
                return end-start;
            }

            var scrollEnd = this.dataSource.recordCount() - this.options.frozenRowsTop;

            if(start < end && start >= this.viewport.begin && start < this.viewport.end) {
                var count = r(start - this.viewport.begin, Math.min(this.viewport.end, end) - this.viewport.begin, this.scrollingcontainer);
                start = Math.min(scrollEnd, end);
                this.viewport.end -= count;
            }

            this.updateViewport();
            this.adjustHeights();
        },
        
        viewRange: function() {
            var self = this,
                start = this.options.frozenRowsTop,
                end = this.dataSource.recordCount() - this.options.frozenRowsBottom,
                sPos = this.getScrollPosition(),
                sArea = this.getScrollAreaSize(),
                range = this.rowsInView(sPos.top, sPos.top + sArea.height, start, end);
            
            range.begin = Math.max(start, range.begin - this.options.virtualScrollingExcess);
            range.end = Math.min(end, range.end + this.options.virtualScrollingExcess);
            
            return range;
        },
        
        scrollToCell: function(rowIdx, columnKey) {
            var self = this,
                start = this.options.frozenRowsTop,
                end = this.dataSource.recordCount() - this.options.frozenRowsBottom,
                sPos = this.getScrollPosition(),
                sArea = this.getScrollAreaSize(),
                range = this.rowsInView(sPos.top, sPos.top + sArea.height, start, end),
                newScrollTop = sPos.top,
                newScrollLeft = sPos.left;
                                               
            if( (!this.options.frozenRowsTop || rowIdx >= this.options.frozenRowsTop) &&
                (!this.options.frozenRowsBottom || rowIdx < this.dataSource.recordCount() - this.options.frozenRowsBottom)) {
             
                // row is in scrolling part
                if(rowIdx <= range.begin || rowIdx >= range.end) {
                    // row is outside viewport. we gotta scroll.
                    newScrollTop = Math.max(0, this.rowHeight(start, rowIdx) - sArea.height / 2);
                }
            }
            
            this.scrollTo(newScrollLeft, newScrollTop);
        },

        _addRows: function(start, end) {
            var range = this.viewRange();
            
            if(start >= this.viewport.begin && start <= this.viewport.end) {
                console.log("Adding rows " + start + " to " + end);
                // new rows being added to the virtual scrolling container, so that means:
                // a) insert some rows between two existing rows
                // b) remove the rows that are no longer in the viewport
                // Preferably we'd do b first.
                end = Math.min(range.end, end);
                this.renderRowGroupContents(start, end, this.scrollinggroup, false, start-this.viewport.begin-1);
                this.viewport.end += (end - start);
            }

            this.updateViewport();
            this.adjustHeights();
        },
        
        _applyDiff: function(diff) {
            for(var x=0,l=diff.length;x<l;x++) {
                var d = diff[x];
                if(d.add) {
                    this._addRows(d.add[0],d.add[1]);
                } else if(d.remove) {
                    this._removeRows(d.remove[0], d.remove[1]);
                }
            }
        },
        
        _dataChanged: function(data, oldData) {
            var diff = this.diff(oldData, data);
            this._applyDiff(diff);
        },

        updateViewport: function() {
            var self = this,
                start = this.options.frozenRowsTop,
                end = this.dataSource.recordCount() - this.options.frozenRowsBottom,
                sPos = this.getScrollPosition(),
                sArea = this.getScrollAreaSize(),
                range = this.rowsInView(sPos.top, sPos.top + sArea.height, start, end),
                scrolling = this.scrollingcontainer,
                group = this.scrollinggroup,
                allParts = group.all;

            // adjust range with excess
            range.begin = Math.max(start, range.begin - this.options.virtualScrollingExcess);
            range.end = Math.min(end, range.end + this.options.virtualScrollingExcess);

            if(range.begin == this.viewport.begin && range.end == this.viewport.end) return; // viewport hasn't changed, so bail out

            var leadingHeight = this.rowHeight(start, range.begin),
                trailingHeight = this.rowHeight(range.end, end);

            function overlap(a,b) {
                if(a.begin <= b.begin && a.end >= b.begin) return true;
                if(a.begin <= b.end && a.end >= b.end) return true;
                if(a.begin >= b.begin && a.end <= b.end) return true;
                if(a.begin <= b.begin && a.end >= b.end) return true;
            }

            if(overlap(range, this.viewport)) {
                if(range.begin < this.viewport.begin) {
                    // have to add rows to beginning
                    this.renderRowGroupContents(Math.max(start, range.begin), Math.min(range.end, this.viewport.begin), this.scrollinggroup, true);
                } else if(range.begin > this.viewport.begin) {
                    // have to remove rows from beginning
                    allParts.each(function(i,part) {
                        $(part).children('.pg-row:lt(' + (range.begin - self.viewport.begin) + ')').remove();
                    });
                }

                if(range.end < this.viewport.end && range.end > this.viewport.begin) {
                    // have to remove rows from end
                    allParts.each(function(i,part) {
                        $(part).children('.pg-row:gt(' + (self.viewport.begin + range.end - range.begin - 1) + ')').remove();
                    });
                } else if(range.end > this.viewport.end) {
                    // have to add rows to end
                    this.renderRowGroupContents(Math.max(this.viewport.end, range.begin), Math.min(range.end, end), this.scrollinggroup, false);
                }
            } else {
                // no overlap, just clear the entire thing and rebuild
                allParts.empty();
                this.renderRowGroupContents(Math.max(start, range.begin), Math.min(range.end, end), this.scrollinggroup, false);
            }

            allParts.css('padding-top', leadingHeight + 'px');
            allParts.css('padding-bottom', trailingHeight + 'px');

            if(false) { // change to if(true) if you want to debug virtual scrolling. Disable for performance
                // verify
                var idxsMatched = {};
                $(allParts).children('.pg-row').each(function(i, row) {
                    var idx = parseInt($(row).attr('data-row-idx'));
                    idxsMatched[idx] = true;
                    if(idx < range.begin || idx >= range.end) {
                        debugger;
                    }
                });

                for(var x = range.begin; x < range.end ; x++) {
                    if(!idxsMatched[x]) {
                        debugger;
                    }
                }
            }

            this.viewport = range;
        },
        
        _updateStyle: function(temporary, selector, style) {
            if(temporary === true) {
                $(selector).css(style);
            } else {
                if(temporary === false) {
                    // means we explicitely invoke this after temporary changes, so reset the temporary changes first
                    var reset = {};
                    Object.keys(style).forEach(function(key) { reset[key] = ""; });
                    $(selector).css(reset);
                }
                vein.inject(selector, style);
            }
        },

        adjustWidths: function adjustWidths(temporary) {
            // Adjusts the widths of onscreen parts. Triggered during init, or when changing column specifications
            var columns = this.options.columns;
            for(var x = 0, l=columns.length; x < l; x++) {
                var column = columns[x];
                var w = this.columnWidth(x);
                if(this.options.fullWidth  && (x == this.options.columns.length - this.options.frozenColumnsRight  - 1)) {
                    this._updateStyle(temporary, this.baseSelector + " .pg-column" + column.key, {"width": "auto", "min-width": w + "px", "right": "0"});
                } else {
                    this._updateStyle(temporary, this.baseSelector + " .pg-column" + column.key, {"width": w + "px", "right": "auto"});
                }
            }
            
            var leadingWidth = this.columnWidth(0, this.options.frozenColumnsLeft);
            var middleWidth = this.columnWidth(this.options.frozenColumnsLeft, this.options.columns.length - this.options.frozenColumnsRight);
            var trailingWidth = this.columnWidth(this.options.columns.length - this.options.frozenColumnsRight, this.options.columns.length);
            this.fixedLeft.css("width", leadingWidth + "px");
            this.fixedRight.css("width", trailingWidth + "px");
            this.columnheadergroup.right && this.columnheadergroup.right.css("width", (trailingWidth + scrollBarSize.width) + "px");
            this.middleScrollers.css({"left": leadingWidth + "px", "width": middleWidth + "px"});
            this.scrollFiller.css({"width": (leadingWidth + middleWidth + trailingWidth + this.scroller.width() - this.scrollingcontainer.width()) + "px"});
            
            if(this.options.autoResize) {
                this.container.css({"width": (this.columnWidth(0, this.options.columns.length)) + "px" });
            }
        },

        adjustHeights: function adjustHeights() {
            // Adjusts the heights of onscreen parts. Triggered during init, or when changing row heights and such
            var columnHeaderHeight = this.headerHeight();
            var headerHeight = this.rowHeight(0, this.options.frozenRowsTop);
            var footerHeight = this.rowHeight(this.dataSource.recordCount() - this.options.frozenRowsBottom, this.dataSource.recordCount());
            this.columnheadercontainer.css("height", (columnHeaderHeight) + "px");
            this.columnheadergroup.all.css("height", (columnHeaderHeight) + "px");
            
            this.headercontainer && this.headercontainer.css("height", (headerHeight) + "px").css("top", (columnHeaderHeight) + "px");
            this.footercontainer && this.footercontainer.css("height", (footerHeight) + "px");
            
            this.scrollingcontainer.css("top", (columnHeaderHeight + headerHeight) + "px").css("bottom", (footerHeight + (this.options.autoResize ? 0 : scrollBarSize.height)) + "px");
            
            this.scroller.css("top", columnHeaderHeight + "px");
            this.scrollFiller.css({"height": this.rowHeight(0, this.dataSource.recordCount()) + this.scroller.height() - this.scrollingcontainer.height() });

            if(this.options.autoResize) {
                this.container.css({"height": (this.rowHeight(0, this.dataSource.recordCount()) + columnHeaderHeight) + "px"});
            }
        },
        
        headerHeight: function headerHeight() {
            return this.target.find(".pg-columnheader").height();
        },

        adjustColumnPositions: function adjustColumnPositions(temporary) {
            // Repositions all columns horizontal positions
            var columns = this.options.columns;
            var pos = 0;
            var positions = new Array(this.options.length);
            for(var x=0, l = columns.length; x<l; x++) {
                var column = columns[x];
                if(x == this.options.frozenColumnsLeft || l-x == this.options.frozenColumnsRight) {
                    pos = 0;
                }
                positions[x] = pos;
                this._updateStyle(temporary, this.baseSelector + " .pg-column" + column.key, {left: pos + "px"});
                column.offsetLeft = pos;

                pos += column.width;
            }
            
            this.adjustWidths(temporary);

            return positions;
        },

        columnWidth: function columnWidth(start, end) {
            // Calculate the width of a single column, or of a range of columns
            if(end == undefined) {
                return this.options.columns[start].width;
            } else {
                var sum=0;
                while(start<end) {
                    sum += this.options.columns[start++].width;
                }
                return sum;
            }
        },

        rowHeight: function rowHeight(start, end) {
            // if end argument is passed, calculates the accumulative heights of rows start until end (exclusive)
            if(end == undefined) {
                return 31;
            } else {
                return (end - start) * 31;
            }
        },

        rowsInView: function(top, bottom, start, end) {
            // Finds rows within the viewport defined by poth coordinates in pixels
            // If start is defined, row position is measured relative to start index.
            // If end is defined, counting stops at end index
            var begin=-1, ct=0;
            for(var x=(start||0),l=end||this.dataSource.recordCount();x<l;x++) {
                ct += this.rowHeight(x);
                if(ct>=top && begin===-1) {
                    begin = x;
                } else if(ct > bottom) {
                    break;
                }
            }
            if(begin > -1) {
                return { begin: begin, end: x };
            } else {
                return { begin: 0, end: 0 };
            }
        },

        scrollBy: function(dX, dY) {
            // Scroll by a specific offset
            this.scroller[0].scrollTop += dY;
            this.scroller[0].scrollLeft += dX;
            this.afterscroll();
        },

        scrollTo: function(x, y) {
            // Scroll to a specific location
            this.scroller[0].scrollTop = Math.max(0, y);
            this.scroller[0].scrollLeft = Math.max(0, x);
            this.afterscroll();
        },

        getScrollPosition: function() {
            // Get the current scroll coordinates
            return {
                left: this.scroller[0].scrollLeft,
                top: this.scroller[0].scrollTop
            };
        },

        getScrollAreaSize: function() {
            return {
                width: this.container.children('.pg-rowgroup.pg-scrolling').children('.pg-container.pg-scrolling')[0].offsetWidth,
                height: this.container.children('.pg-rowgroup.pg-scrolling')[0].offsetHeight
            };
        },

        syncScroll: function syncScroll(source, event) {
            // Sync the scrolling between the scrolling divs
            // tested CSS class injection, but was slower than direct manipulation in this case
            if(!source) source = this.scroller[0];
            this.container.children('.pg-scrolling').scrollTop(source.scrollTop);
            this.middleScrollers.css('transform', 'translate(-' + source.scrollLeft + 'px,0)');
            this.afterscroll();
        },

        afterscroll: function() {
            var self = this;
            if(!this.updateViewportTimer) {
                this.updateViewportTimer = setTimeout(function() {
                    requestAnimationFrame(self.updateViewport.bind(self));
                    self.updateViewportTimer = null;
                }, 100);
            }
            $(this).trigger('scroll');
        },

        renderHeaderCell: function renderHeaderCell(column, columnIdx) {
            // Render the cell for the header
            return $("<div class='pg-columnheader'>").append($("<span>").text(column.title));
        },

        renderCell: function renderCell(record, column, rowIdx, columnIdx) {
            // Render the cell container
            return $("<div class='pg-cell'>").append(this.renderCellContent(record, column));
        },
        
        renderCellContent: function(record, column) {
            return this.renderCellValue(record, column, this.getCellTextValue(record[column.key], record, column))
        },
        
        updateCellValues: function(list) {
            for(var x=0,l=list.length;x<l;x++) {
                this.updateCellValue(list[x].id, list[x].key);
            }
        },
        
        afterCellRendered: function(record, column, cell) {
            
        },
        
        updateCellValue: function(rowId, key) {
            var row = this.container.find("> .pg-rowgroup > .pg-container > .pg-row[data-row-id='" + rowId + "']");
            var cell = row.children(".pg-cell[data-column-key='" + key + "']");
            if(cell.length) {
                var record = this.dataSource.getRecordById(rowId),
                    column = this.getColumnForKey(key);
                cell.empty().append(this.renderCellContent(record, column));
                this.afterCellRendered(record, column, cell);
            }
        },

        renderCellValue: function renderCellValue(record, column, value) {
            // Render the cell content
            return value != null ? $("<span>").text(value) : $("<span>");
        },

        getCellTextValue: function (value, record, column) {
            return value;
        },

        getColumnForKey: function(key) {
            return this.getColumnForIndex(this.getColumnIndexForKey(key));
        },

        getColumnForIndex: function(index) {
            return this.options.columns[index];
        },
        
        columnCount: function() {
            return this.options.columns.length;
        },
        
        getColumnIndexForKey: function(key) {
            // Returns the column for the given key
            for(var x=0,l=this.options.columns.length; x<l; x++) {
                if(this.options.columns[x].key == key) {
                    return x;
                }
            }
        },
        
        getCellFor: function(rowId, key) {
            return this.container.find(".pg-row[data-row-id='" + rowId + "'] > .pg-cell[data-column-key='" + key + "']");
        },

        trigger: function(eventName, data) {
            $(this).trigger(eventName, data);
            $(this.target).trigger(eventName, data);
        },

        on: function(eventName, handler) {
            return $(this).on(eventName, handler);
        },

        getRowGroupFor: function(rowIndex) {
            if(rowIndex < this.options.frozenRowsTop) {
                return this.headergroup;
            } else if(rowIndex > this.dataSource.recordCount() - this.options.frozenRowsBottom) {
                return this.footergroup;
            } else {
                return this.scrollinggroup;
            }
        },
        
        diff: function(a, b) {
            // Utility function. Generates a list of actions (add, remove) to take to get from list a to list b.
            // Extremely useful when doing incremental DOM tree updates from one dataset to another.
            
            function idMap(a) {
                var m = {};
                for(var x=0,l=a.length;x<l;x++) m[a[x].id] = a[x];
                return m;
            }
            
            // special cases
            if(!a.length && !b.length) return [];
            if(!a.length) return [{add: [0, b.length]}];
            if(!b.length) return [{remove: [0, a.length]}];
            
            var diff = [], lastdiff;
            var ia = idMap(a);
            var c = [];
            // first find rows to remove
            for(var xa=a.length-1,xb=b.length-1;xa>=0;) {
                while(xb >= 0 && !ia[b[xb].id]) xb--;
                if(xb < 0) {
                    diff.push({remove: [0, xa+1]});
                    break;
                } else {
                    var sa = xa;
                    while(xa >=0 && a[xa].id !== b[xb].id) xa--;
                    if(xa >= 0) c.unshift(a[xa]);
                    if(xa !== sa) diff.push({remove: [xa+1, sa+1]});
                    xa--;xb--;
                }
            }
            
            // find the ones to add now. since these operations will be done
            // on a subset of a that only contains the items also in b, we
            // use c as a base.
            if(c.length == 0) {
                // apparently there was no overlap between a and b, so all of b can be added
                diff.push({add: [0, b.length]});
            } else {
                for(var xc=0, xb=0;xb < b.length && xc < c.length;) {
                    while(xb < b.length && xc < c.length && c[xc].id === b[xb].id) {
                        xc++; xb++;
                    }

                    if(xb >= b.length) break;

                    var sb = xb;

                    if(xc >= c.length) {
                        xb = b.length;
                    } else {
                        while(c[xc].id !== b[xb].id) xb++;
                    }
                    if(sb !== xb) diff.push({add: [sb, xb]});
                }
            }
            
            return diff;
        },
        saveSetting: function (id, value) {
            localStorage[this.options.settingsId + "_" + id] = JSON.stringify(value);
        },

        loadSetting: function(id) {
            var s = localStorage[this.options.settingsId + "_" + id];
            if (s) {
                return JSON.parse(s);
            }
        }
    };

    $.fn.extend({ PowerGrid: function(options) {
        var d = this.data("powergrid");
        
        if(options) {
            if(d) d.destroy();
            d = new PowerGrid(this, options);
            this.data("powergrid", d);
        }

        return d;
    }});

    return PowerGrid;
});