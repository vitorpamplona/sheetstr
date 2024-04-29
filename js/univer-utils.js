function convertUniverToDataArray(saveData) {
    console.log("Saving1", saveData)
    data = []

    for (sheetName of saveData.sheetOrder) {
        console.log(sheetName);

        let sheet = saveData.sheets[sheetName]

        try {
            for (rowNumber of Object.keys(sheet.cellData)) {
                let row = sheet.cellData[rowNumber]
                for (colNumber of Object.keys(row)) {
                    let col = row[colNumber]
                    if (col.f)
                        data.push([sheet.name, UniverCore.numberToABC(colNumber), (parseInt(rowNumber) + 1).toString(), col.f]);
                    else
                        data.push([sheet.name, UniverCore.numberToABC(colNumber), (parseInt(rowNumber) + 1).toString(), col.v.toString()]);
                }
            }
        } catch (e) {
            console.log(e)
        }
    }

    console.log("Saving2", data)
    return data
}

function convertDataArrayToUniver(name, data) {
    console.log("Load from", name, data)

    if (data.length === 0) {
        return {}
    } else {
        let workbook = {
            id: UniverCore.Tools.generateRandomId(6),
            locale: UniverCore.LocaleType.EN_US,
            appVersion: "0.1.7",
            name: name,
            sheetOrder: [],
            sheets: {},
            styles: {},
            resources: [],
        }
        for (rowColData of data) {
            let sheetName = rowColData[0]
            if (!workbook.sheetOrder.includes(sheetName)) {
                workbook.sheetOrder.push(sheetName)
            }

            let row = parseInt(rowColData[2]) - 1
            let col = UniverCore.ABCToNumber(rowColData[1])

            let type = 1
            let formula = undefined
            let value = undefined
            if (rowColData[3][0] == "=") {
                formula = rowColData[3]
            } else {
                let valueClass = Number(rowColData[3]);
                if (!isNaN(valueClass)) {
                    value = parseFloat(rowColData[3])
                    type = 2
                } else {
                    value = rowColData[3]
                }
            }

            if (!workbook.sheets[sheetName]) {
                workbook.sheets[sheetName] = {
                    id: sheetName,
                    cellData: {},
                    rowData: {}
                }
            }

            if (!workbook.sheets[sheetName].cellData[row]) {
                workbook.sheets[sheetName].cellData[row] = {}
            }

            if (!workbook.sheets[sheetName].cellData[row][col]) {
                workbook.sheets[sheetName].cellData[row][col] = {}
            }

            workbook.sheets[sheetName].cellData[row][col] = {
                t: type,
                v: value,
                f: formula,
            }
        }
        console.log("Openning", workbook)

        return workbook
    }
}