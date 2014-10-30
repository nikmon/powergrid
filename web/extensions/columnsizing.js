define(['override', 'utils', 'jquery'], function(override, utils, $) {
    
    "use strict";
    
    return {
        loadFirst: ['filtering'],
        init: function(grid, pluginOptions) {
            override(grid, function($super) {
                return {
                    renderHeaderCell: function() {
                        var h = $super.renderHeaderCell.apply(this, arguments);
                        var handle = $("<div class='pg-resizehandle'></div><div class='pg-removable'></div>");
                        h.append(handle);
                        return h;
                    },
                    
                    adjustColumnPositions: function(temp) {
                        //loop over the columns and find which has the inidator and toogle the class
                        
                        for (var k = 0; k< grid.options.columns.length-1; k++) {
                            var column = grid.options.columns[k],
                                hidden = column.width==0,
                                indexCurrentKey = grid.getColumnIndexForKey(column.key),
                                newIndexCurrentKey = indexCurrentKey +1,
                                nextObject = grid.getColumnForIndex(newIndexCurrentKey);   
                            
                    console.log(nextObject);
                            //Toogle
                            $(grid.container).find(".pg-columnheader[data-column-key='" + nextObject.key + "']").find(".pg-removable").toggleClass("display",hidden);
                            
                            
                            }
                          
                        return $super.adjustColumnPositions(temp);
                    },

                    init: function() {
                        for (var x = 0, l = this.options.columns.length; x < l; x++) {
                            var column = this.options.columns[x];
                            var width = this.loadSetting(column.key + "_width");
                            if (width !== undefined && width !== null && width !== "") {
                                column.width = width;
                            }
                        }

                        $super.init();
                        var header, key, idx, col,nextCol, oX, w, offset, resizing=0;

                        function startResize(event) {
                            if($(this).parents('.powergrid')[0] !== grid.container[0]) return;
                            header = event.target.parentNode;
                            key = $(header).attr("data-column-key");
                            idx = utils.findInArray(grid.options.columns, function(col) { return col.key == key; });
                            col = grid.options.columns[idx];
                            oX = event.pageX;
                            w = col.width;

                            offset = event.offsetX || event.originalEvent.layerX || 0;

                            if(idx < grid.options.columns.length - grid.options.frozenColumnsRight) { // it's not a right frozen column
                                resizing = 1;
                            } else if(idx >= grid.options.columns.length - grid.options.frozenColumnsRight) {
                                resizing = -1;
                            }
                        }

                        function doResize(event) {
                            if(resizing == 1) {
                                col.width = Math.max(0, event.pageX - oX + w);
                            } else if(resizing == -1) {
                                col.width = Math.max(0, oX - event.pageX + w);
                            } else {
                                return;
                            }
                            requestAnimationFrame(function() {
                                grid.adjustColumnPositions(true);
                            });
                        }

                        function endResize(event) {
                            if(resizing !== 0) {
                                resizing = 0;
                                grid.saveSetting(col.key + "_width", col.width);
                                event.preventDefault();
                                event.stopImmediatePropagation();
                                requestAnimationFrame(function() {
                                    grid.adjustColumnPositions(false); // final redraw
                                })
                            }
                        }
                        
                        function remove(event){
                            
                            var currentHeader = event.currentTarget;
                           
                            var currentKey = $(currentHeader).attr("data-column-key");
                           
                            var indexCurrentKey= grid.getColumnIndexForKey(currentKey);
                           
                            var newIndexCurrentKey= indexCurrentKey +1;
                           
                            var nextObject= grid.getColumnForIndex(newIndexCurrentKey);   
                            
                            //Toogle
                            $(grid.container).find(".pg-columnheader[data-column-key='" + nextObject.key + "']").find(".pg-removable").toggleClass("display");
                                                   
                            var col = grid.getColumnForKey(currentKey);
                            col.width=0;
                             
                            requestAnimationFrame(function() {
                                grid.adjustColumnPositions(true); // final redraw
                            })
                           
                        }
                        
                        function show(event){
                           
                            //Define the start point
                            var startIndex = grid.getColumnIndexForKey($(event.target.parentNode).data('column-key'));
                            
                            //Loop over the Columns object
                            for (var i=startIndex; i > 0; i--) {
                               
                                var temp=$(grid.container).find(".pg-columnheader[data-column-key='" + i + "']").find(".pg-removable");
                                                                
                                 //Define the current column    
                                 var column = grid.getColumnForIndex(i);
                                    
                                    //Check if the current column is hidden
                                    if (column.width == 0) {
                                        
                                        column.width = 100;
                                        //Increase by one the counter. The next Colunn include the removable div!!
                                        var k=i+1;
                                        
                                        //Toogle
                                        $(grid.container).find(".pg-columnheader[data-column-key='" + k + "']").find(".pg-removable").toggleClass("display");
                                        
                                    }
                                
                                
                                //Retrieve the previous Column
                                var prevColumn = grid.getColumnForIndex(i-1);
                                //If the following is not hidden then stop the Loop
                                if (prevColumn.width != 0) {
                                   break;
                                }
                                
                            }
                            
                            
                            requestAnimationFrame(function() {
                                grid.adjustColumnPositions(true); // final redraw
                            })
                            
                            event.stopImmediatePropagation();
                                event.preventDefault();
                                event.stopPropagation();
                            
                        }

                        this.target
                            .on("mousedown", ".pg-resizehandle", startResize)
                            .on("mousemove", doResize)
                            .on("mouseup", ":not(.pg-resizehandle)", endResize)
                            .on("dblclick",".pg-columnheader",remove)             
                            .on("dblclick",".pg-removable",show)
                            .on("click", ".pg-resizehandle", function(event) {
                                event.stopImmediatePropagation();
                                event.preventDefault();
                                event.stopPropagation();
                            });
                    }
                }
            });
        }
    };
    
});