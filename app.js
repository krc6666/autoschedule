// ===== 导航 =====
document.getElementById('topNav').addEventListener('click', function(e) {
    if (e.target.classList.contains('nav-btn')) {
        document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
        e.target.classList.add('active');
        var tab = e.target.dataset.tab;
        document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
        document.getElementById('panel-' + tab).classList.add('active');
        if (tab === 'schedule') renderSchedule();
        if (tab === 'history') renderHistory();
    }
});

function switchTab(tab) {
    document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
    var btn = document.querySelector('.nav-btn[data-tab="' + tab + '"]');
    if (btn) btn.classList.add('active');
    document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
    document.getElementById('panel-' + tab).classList.add('active');
    if (tab === 'schedule') renderSchedule();
    if (tab === 'history') renderHistory();
}

// ===== 文件导入 =====
function handleFileInput(input) {
    var file = input.files[0];
    if (!file) return;
    var reader = new FileReader();
    reader.onload = function(e) {
        try {
            var data = new Uint8Array(e.target.result);
            var workbook = XLSX.read(data, { type: 'array' });
            importFromExcel(workbook);
        } catch (err) {
            alert('导入失败：' + err.message);
        }
    };
    reader.readAsArrayBuffer(file);
    input.value = '';
}
function importConfig() { document.getElementById('fileInput').click(); }
function importFlights() { document.getElementById('fileInput').click(); }
function importHistory() { document.getElementById('fileInput').click(); }

// ===== 初始化 =====
function init() {
    try {
        initConfig();
        renderTemplates();
        renderPositions();
        renderStaff();
        renderFlights();
        renderTemplateSelect();
        renderSchedule();
        renderHistory();
    } catch(e) {
        alert('初始化出错：' + e.message);
    }
}

// ===== 航班计划 =====
function renderFlights() {
    var flights = getFlights();
    var tbody = document.getElementById('flightTable');
    tbody.innerHTML = flights.map(function(f, i) {
        return '<tr>' +
            '<td><input type="text" value="' + f.flightNo + '" onchange="updateFlight(' + i + ',\'flightNo\',this.value)"></td>' +
            '<td><input type="time" value="' + f.startTime + '" onchange="updateFlight(' + i + ',\'startTime\',this.value)"></td>' +
            '<td><input type="time" value="' + f.endTime + '" onchange="updateFlight(' + i + ',\'endTime\',this.value)"></td>' +
            '<td><input type="number" value="' + (f.bookedPassengers||0) + '" onchange="updateFlight(' + i + ',\'bookedPassengers\',parseInt(this.value)||0)"></td>' +
            '<td><input type="text" value="' + f.positions + '" onchange="updateFlight(' + i + ',\'positions\',this.value)" style="min-width:150px;"></td>' +
            '<td><input type="text" value="' + (f.remark||'') + '" onchange="updateFlight(' + i + ',\'remark\',this.value)"></td>' +
            '<td><button class="btn btn-sm btn-war" onclick="deleteFlight(' + i + ')">删除</button></td>' +
        '</tr>';
    }).join('');
}
function addFlight() {
    var modalHtml = '<div style="position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,.5);z-index:9999;display:flex;justify-content:center;align-items:center;" id="addFlightModal">' +
        '<div style="background:#fff;border-radius:12px;padding:24px;width:450px;max-width:90%;box-shadow:0 10px 40px rgba(0,0,0,.2);">' +
        '<h3 style="margin:0 0 20px 0;font-size:16px;color:#1a1a2e;">添加新航班</h3>' +
        '<div style="display:flex;flex-direction:column;gap:12px;">' +
        '<div><label style="display:block;font-size:13px;color:#555;margin-bottom:4px;">航班号</label><input type="text" id="newFlightNo" style="width:100%;padding:8px;border:1px solid #ddd;border-radius:6px;font-size:13px;" placeholder="如：CX937"></div>' +
        '<div style="display:flex;gap:12px;">' +
        '<div style="flex:1;"><label style="display:block;font-size:13px;color:#555;margin-bottom:4px;">开始时间</label><input type="time" id="newStartTime" style="width:100%;padding:8px;border:1px solid #ddd;border-radius:6px;font-size:13px;" value="08:00"></div>' +
        '<div style="flex:1;"><label style="display:block;font-size:13px;color:#555;margin-bottom:4px;">结束时间</label><input type="time" id="newEndTime" style="width:100%;padding:8px;border:1px solid #ddd;border-radius:6px;font-size:13px;" value="10:00"></div>' +
        '</div>' +
        '<div><label style="display:block;font-size:13px;color:#555;margin-bottom:4px;">预定人数</label><input type="number" id="newBookedPassengers" style="width:100%;padding:8px;border:1px solid #ddd;border-radius:6px;font-size:13px;" value="0" min="0"></div>' +
        '<div><label style="display:block;font-size:13px;color:#555;margin-bottom:4px;">涉及岗位（逗号分隔）</label><input type="text" id="newPositions" style="width:100%;padding:8px;border:1px solid #ddd;border-radius:6px;font-size:13px;" placeholder="如：督导,G20,G19"></div>' +
        '<div><label style="display:block;font-size:13px;color:#555;margin-bottom:4px;">备注</label><input type="text" id="newRemark" style="width:100%;padding:8px;border:1px solid #ddd;border-radius:6px;font-size:13px;" placeholder="如：到岗时间"></div>' +
        '</div>' +
        '<div style="display:flex;gap:8px;justify-content:flex-end;margin-top:20px;">' +
        '<button style="padding:7px 16px;border:1px solid #ddd;border-radius:6px;font-size:13px;color:#666;cursor:pointer;transition:.15s;" onclick="document.getElementById(\'addFlightModal\').remove()">取消</button>' +
        '<button style="padding:7px 16px;border:none;border-radius:6px;font-size:13px;color:#fff;background:#4361ee;cursor:pointer;transition:.15s;" onclick="confirmAddFlight()">确定添加</button>' +
        '</div>' +
        '</div>' +
        '</div>';
    document.body.insertAdjacentHTML('beforeend', modalHtml);
}
function confirmAddFlight() {
    var flightNo = document.getElementById('newFlightNo').value.trim();
    var startTime = document.getElementById('newStartTime').value;
    var endTime = document.getElementById('newEndTime').value;
    var bookedPassengers = parseInt(document.getElementById('newBookedPassengers').value) || 0;
    var positions = document.getElementById('newPositions').value.trim();
    var remark = document.getElementById('newRemark').value.trim();
    
    if (!flightNo) {
        alert('请输入航班号！');
        return;
    }
    if (!startTime || !endTime) {
        alert('请输入航班时间！');
        return;
    }
    
    var flights = getFlights();
    flights.push({ 
        flightNo: flightNo, 
        startTime: startTime, 
        endTime: endTime, 
        bookedPassengers: bookedPassengers, 
        positions: positions, 
        remark: remark 
    });
    saveFlights(flights);
    renderFlights();
    document.getElementById('addFlightModal').remove();
}
function updateFlight(index, field, value) {
    var flights = getFlights();
    flights[index][field] = value;
    saveFlights(flights);
}
function deleteFlight(index) {
    var flights = getFlights();
    flights.splice(index, 1);
    saveFlights(flights);
    renderFlights();
}

function renderTemplateSelect() {
    var templates = getFlightTemplates();
    var select = document.getElementById('templateSelect');
    if (!select) return;
    select.innerHTML = '<option value="">-- 从模板添加航班 --</option>' +
        templates.map(function(t, i) {
            return '<option value="' + i + '">' + t.flightNo + ' (' + t.startTime + '-' + t.endTime + ')</option>';
        }).join('');
}

function onTemplateSelect() {
    var select = document.getElementById('templateSelect');
    var idx = select.value;
    if (idx === '') return;
    var templates = getFlightTemplates();
    var t = templates[parseInt(idx)];
    if (!t) return;
    var flights = getFlights();
    flights.push({
        flightNo: t.flightNo,
        startTime: t.startTime,
        endTime: t.endTime,
        bookedPassengers: 0,
        positions: t.positions,
        remark: t.remark || '',
        templateLocked: true
    });
    saveFlights(flights);
    renderFlights();
    select.value = '';
}

// ===== 自动排班（带错误处理） =====
function doAutoSchedule() {
    try {
        autoSchedule();
    } catch(e) {
        alert('自动排班出错：' + e.message + '\n请检查控制台了解详情。');
        console.error(e);
    }
}

function doReset() {
    saveSchedule([]);
    renderSchedule();
}

// 历史页面"排明天班"按钮
function doScheduleTomorrow() {
    var history = getHistory();
    if (history.length === 0) {
        alert('请先导入上一工作日的排班Excel！');
        return;
    }
    try {
        autoSchedule();
        switchTab('schedule');
    } catch(e) {
        alert('排班出错：' + e.message);
        console.error(e);
    }
}

// ===== 排班展示（横排：每个航班一列） =====
function renderSchedule() {
    var schedule = getSchedule();
    var flights = getFlights();
    var staff = getStaff();
    var positions = getPositions();

    var pool = document.getElementById('staffPool');
    var assignedIds = {};
    schedule.forEach(function(s) { if (s.staffId) assignedIds[s.staffId] = true; });
    pool.innerHTML = staff.map(function(s) {
        var cls = s.status !== '正常' ? 'staff-tag absent' : 'staff-tag';
        var title = s.status !== '正常' ? (s.remark || s.status) : '';
        return '<span class="' + cls + '" draggable="true" ' +
            'ondragstart="dragStart(event,\'staff\',' + s.id + ',\'' + s.name + '\')" ' +
            'ondragend="dragEnd(event)" title="' + title + '" ' +
            'style="' + (assignedIds[s.id] ? 'opacity:0.4;' : '') + '">' +
            s.name + (s.status !== '正常' ? ' (' + s.status + ')' : '') +
        '</span>';
    }).join('');

    var area = document.getElementById('scheduleArea');
    if (flights.length === 0) {
        area.innerHTML = '<div class="card"><div style="text-align:center;padding:40px;color:#999">请先在"航班计划"中添加航班</div></div>';
        renderStats();
        return;
    }
    if (schedule.length === 0) {
        area.innerHTML = '<div class="card"><div style="text-align:center;padding:40px;color:#999">点击"自动排班"按钮生成排班结果</div></div>';
        renderStats();
        return;
    }

    var flightData = [];
    var maxRows = 0;
    flights.forEach(function(flight) {
        var flightSchedule = schedule.filter(function(s) { return s.flightNo === flight.flightNo; });
        if (flightSchedule.length === 0) return;
        var seen = {};
        var unique = [];
        for (var i = flightSchedule.length - 1; i >= 0; i--) {
            if (!seen[flightSchedule[i].position]) {
                seen[flightSchedule[i].position] = true;
                unique.unshift(flightSchedule[i]);
            }
        }
        flightData.push({ flight: flight, items: unique });
        if (unique.length > maxRows) maxRows = unique.length;
    });

    if (flightData.length === 0) {
        area.innerHTML = '<div class="card"><div style="text-align:center;padding:40px;color:#999">暂无排班数据</div></div>';
        renderStats();
        return;
    }

    var extraRows = 3;

    var html = '<div style="overflow-x:auto;margin-bottom:12px;border:1px solid #ddd;border-radius:8px;overflow:hidden;">' +
        '<table style="border-collapse:collapse;width:auto;min-width:100%;font-size:13px;table-layout:fixed;">';

    html += '<thead><tr>';
    flightData.forEach(function(fd) {
        html += '<th style="border:1px solid #ddd;background:#4361ee;color:#fff;padding:10px 8px;text-align:center;width:' + (100/flightData.length) + '%;font-weight:600;">' +
            fd.flight.flightNo +
            '<br><span style="font-size:11px;font-weight:400;opacity:0.9">' + fd.flight.startTime + '-' + fd.flight.endTime + '</span>' +
            (fd.flight.remark ? '<br><span style="font-size:10px;font-weight:400;opacity:0.8">' + fd.flight.remark + '</span>' : '') +
        '</th>';
    });
    html += '</tr></thead>';

    html += '<tbody>';
    for (var row = 0; row < maxRows + extraRows; row++) {
        html += '<tr>';
        flightData.forEach(function(fd) {
            var item = fd.items[row];
            if (item) {
                var globalIdx = schedule.indexOf(item);
                var isManual = item.remark === '手动输入项';
                var bg = isManual ? '#fff9e6' : (row % 2 === 0 ? '#fff' : '#fafbfc');
                var posConfig = positions.find(function(p) { return p.flightNo === item.flightNo && p.name === item.position; });
                var posRemark = posConfig ? posConfig.remark : '';
                html += '<td style="border:1px solid #e9ecef;padding:6px 8px;text-align:center;background:' + bg + ';" ' +
                    'id="cell-' + globalIdx + '" ' +
                    'ondragover="allowDrop(event)" ondragleave="dragLeave(event)" ' +
                    'ondrop="dropToCell(event,' + globalIdx + ')">' +
                    '<div style="font-size:13px;font-weight:700;color:#1a1a1a;margin-bottom:3px;">' + item.position + (posRemark ? ' <span style="font-size:12px;color:#4361ee;font-weight:600;">(' + posRemark + ')</span>' : '') + '</div>' +
                    (item.staffName ?
                        '<span class="staff-block" draggable="true" ' +
                            'ondragstart="dragStart(event,\'schedule\',' + globalIdx + ',\'' + item.staffName + '\')" ' +
                            'ondragend="dragEnd(event)">' +
                            item.staffName +
                            '<span class="del" onclick="event.stopPropagation();removeStaffFromSchedule(' + globalIdx + ')">&times;</span>' +
                        '</span>'
                    : '<span style="font-size:11px;color:#bbb;">' + (isManual ? '手动输入' : '拖入') + '</span>') +
                '</td>';
            } else {
                var isExtraRow = row >= maxRows;
                var flightNo = fd.flight.flightNo;
                var startTime = fd.flight.startTime;
                var endTime = fd.flight.endTime;
                var workHours = calculateHours(startTime, endTime);
                if (isExtraRow) {
                    html += '<td style="border:1px dashed #cbd5e1;background:#f0f9ff;min-height:36px;" ' +
                        'ondragover="allowDrop(event)" ondragleave="dragLeave(event)" ' +
                        'ondrop="dropToExtraCell(event,\'' + flightNo + '\',\'' + startTime + '\',\'' + endTime + '\',' + workHours + ')">' +
                        '<span style="font-size:10px;color:#60a5fa;font-style:italic;">拖入临时人员</span>' +
                    '</td>';
                } else {
                    html += '<td style="border:1px solid #e9ecef;background:#f8f9fa;"></td>';
                }
            }
        });
        html += '</tr>';
    }
    html += '</tbody></table></div>';

    area.innerHTML = html;
    renderStats();
}

function renderStats() {
    var schedule = getSchedule();
    var staff = getStaff();
    var history = getHistory();
    var fatigueMap = getFatigueMap(staff, history);
    var tbody = document.getElementById('statsBody');

    var stats = {};
    staff.forEach(function(s) {
        stats[s.id] = { name: s.name, hours: 0, posFatigue: 0, historyFatigue: fatigueMap.get(s.id) || 0, status: s.status };
    });

    schedule.forEach(function(item) {
        if (item.staffId && stats[item.staffId]) {
            stats[item.staffId].hours += item.workHours || 0;
            stats[item.staffId].posFatigue += (item.workHours || 0) * (item.fatigue || 1.0);
        }
    });

    tbody.innerHTML = Object.values(stats).map(function(s) {
        var total = s.posFatigue + s.historyFatigue;
        var badge = '';
        if (total > 30) badge = '<span class="stat-badge stat-hi">高</span>';
        else if (total > 15) badge = '<span class="stat-badge stat-mi">中</span>';
        else if (total > 0) badge = '<span class="stat-badge stat-lo">低</span>';
        return '<tr><td>' + s.name + '</td><td>' + s.hours.toFixed(1) + 'h</td><td>' + s.posFatigue.toFixed(1) + '</td><td>' + s.historyFatigue.toFixed(1) + '</td><td>' + total.toFixed(1) + ' ' + badge + '</td><td>' + s.status + '</td></tr>';
    }).join('');
}

// ===== 历史排班 =====
function renderHistory() {
    var history = getHistory();
    var tbody = document.getElementById('historyBody');
    if (history.length === 0) {
        tbody.innerHTML = '<tr><td colspan="6" style="color:#999;padding:20px">暂无历史记录</td></tr>';
        return;
    }
    tbody.innerHTML = history.map(function(h) {
        return '<tr><td>' + h.date + '</td><td>' + h.flightNo + '</td><td>' + h.position + '</td><td>' + h.staffName + '</td><td>' + h.workHours + 'h</td><td>' + (h.remark || '-') + '</td></tr>';
    }).join('');
}
function clearHistory() {
    if (confirm('确定要清空所有历史记录吗？')) { saveHistory([]); renderHistory(); }
}

// ===== 拖拽 =====
var draggedItem = null, draggedType = null, draggedData = null;

function dragStart(event, type, indexOrId, name) {
    draggedItem = event.target;
    draggedType = type;
    draggedData = { type: type, indexOrId: indexOrId, name: name };
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData('text/plain', JSON.stringify(draggedData));
    event.target.style.opacity = '0.5';
}
function dragEnd(event) {
    if (event.target) event.target.style.opacity = '1';
    [].forEach.call(document.querySelectorAll('.pos-row.drag-over'), function(c) { c.classList.remove('drag-over'); });
    draggedItem = null; draggedType = null; draggedData = null;
}
function allowDrop(event) {
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
    event.currentTarget.classList.add('drag-over');
}
function dragLeave(event) {
    event.currentTarget.classList.remove('drag-over');
}
function dropToCell(event, targetIndex) {
    event.preventDefault();
    event.currentTarget.classList.remove('drag-over');
    var data = JSON.parse(event.dataTransfer.getData('text/plain'));
    if (data.type === 'staff') {
        updateScheduleAssignment(targetIndex, data.name, data.indexOrId);
    } else if (data.type === 'schedule' && draggedData) {
        var src = draggedData.indexOrId;
        if (src !== targetIndex && src >= 0) swapScheduleAssignments(src, targetIndex);
    }
}
function dropToPool(event) {
    event.preventDefault();
    var data = JSON.parse(event.dataTransfer.getData('text/plain'));
    if (data.type === 'schedule' && draggedData) removeStaffFromSchedule(draggedData.indexOrId);
}
function dropToExtraCell(event, flightNo, startTime, endTime, workHours) {
    event.preventDefault();
    var data = JSON.parse(event.dataTransfer.getData('text/plain'));
    if (data.type === 'staff') {
        addTempStaffToSchedule(data.name, data.indexOrId, flightNo, startTime, endTime, workHours);
    } else if (data.type === 'schedule' && draggedData) {
        var schedule = getSchedule();
        var srcItem = schedule[draggedData.indexOrId];
        if (srcItem && srcItem.staffId) {
            if (srcItem.flightNo === flightNo) {
                removeStaffFromSchedule(draggedData.indexOrId);
            } else {
                removeStaffFromSchedule(draggedData.indexOrId);
                addTempStaffToSchedule(srcItem.staffName, srcItem.staffId, flightNo, startTime, endTime, workHours);
            }
        }
    }
}
function addTempStaffToSchedule(staffName, staffId, flightNo, startTime, endTime, workHours) {
    var schedule = getSchedule();
    if (hasTimeConflict(staffId, startTime, endTime, schedule, -1)) {
        alert('该人员在此时间段已有排班！');
        return;
    }
    schedule.push({
        flightNo: flightNo,
        position: '临时人员',
        staffName: staffName,
        staffId: staffId,
        startTime: startTime,
        endTime: endTime,
        workHours: workHours,
        remark: '临时调整',
        fatigue: 1.0
    });
    saveSchedule(schedule);
    renderSchedule();
}

// ===== 勾选弹窗 =====
var checkModalTarget = null; // { flightNo, indexInGroup }

function openCheckModal(flightNo, indexInGroup) {
    var positions = getPositions();
    var staff = getStaff();
    var flightPositions = positions.filter(function(p) { return p.flightNo === flightNo; });
    var pos = flightPositions[indexInGroup];
    if (!pos) return;

    checkModalTarget = { flightNo: flightNo, indexInGroup: indexInGroup };

    var qualifiedIds = [];
    if (pos.qualifiedStaff !== '手动输入项') {
        qualifiedIds = pos.qualifiedStaff.split(',').map(function(id) { return id.trim(); }).filter(function(id) { return id; });
    }

    document.getElementById('checkModalTitle').textContent = flightNo + ' - ' + pos.name + ' 可胜任人员';
    var grid = document.getElementById('checkGrid');
    grid.innerHTML = staff.map(function(s) {
        var checked = qualifiedIds.indexOf(String(s.id)) >= 0;
        var absent = s.status !== '正常';
        return '<label class="check-item' + (absent ? ' absent' : '') + '">' +
            '<input type="checkbox" value="' + s.id + '" ' + (checked ? 'checked' : '') + ' ' + (absent ? 'disabled' : '') + '>' +
            s.name + (absent ? ' (' + s.status + ')' : '') +
        '</label>';
    }).join('');

    document.getElementById('checkModal').classList.add('show');
}

function closeCheckModal() {
    document.getElementById('checkModal').classList.remove('show');
    checkModalTarget = null;
}

function saveCheckModal() {
    if (!checkModalTarget) return;
    var checks = document.querySelectorAll('#checkGrid input[type=checkbox]:checked');
    var ids = [];
    checks.forEach(function(cb) { ids.push(cb.value); });

    var positions = getPositions();
    var flightPositions = positions.filter(function(p) { return p.flightNo === checkModalTarget.flightNo; });
    var globalIndex = positions.indexOf(flightPositions[checkModalTarget.indexInGroup]);
    if (globalIndex >= 0) {
        positions[globalIndex].qualifiedStaff = ids.join(',');
        savePositions(positions);
        renderPositions();
    }
    closeCheckModal();
}

// 点击弹窗背景关闭
document.getElementById('checkModal').addEventListener('click', function(e) {
    if (e.target === this) closeCheckModal();
});

document.addEventListener('DOMContentLoaded', init);