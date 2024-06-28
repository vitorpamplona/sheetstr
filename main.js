var univer = undefined;
var univerAPI = undefined;
var loggedIn = false;
var initialized = false;

var expandedEvents = new Map();
var userNames = new Map();
var showingEvent = undefined;
var hasWarnedAboutOffline = false;

document.addEventListener("nlAuth", (e) => {
  initialized = true;
  console.log("nlauth", e);
  if (e.detail.type === "login" || e.detail.type === "signup") {
    if (!loggedIn) {
      console.log("Logging In");
      loggedIn = true;
      setTimeout(function () {
        loadUser();
      }, 200);
    }
  } else {
    if (loggedIn) {
      console.log("Logging Off");
      loggedIn = false;
      setTimeout(function () {
        logOff();
      }, 200);
    }
  }
});

$(document).ready(function () {
  showDashboard();

  const authorParam = new URLSearchParams(window.location.search).get("author");

  if (authorParam && authorParam.length == 64) {
    loadUser();
  } else {
    console.log("Force Welcome Login");
    setTimeout(function () {
      if (!initialized)
        document.dispatchEvent(
          new CustomEvent("nlLaunch", { detail: "welcome" })
        );
    }, 500);
  }
});

function logOff() {
  $("#sheets").html("");
  showDashboard();
  loggedIn = false;
  if (tentatives) {
    tentatives = 1000;
  }
  if (ws) {
    ws.close();
  }
}

function loadUser() {
  expandedEvents = new Map();
  hasWarnedAboutOffline = false;
  showingEvent = undefined;

  const urlParams = new URLSearchParams(window.location.search);
  const authorParam = urlParams.get("author");

  if (authorParam) {
    loggedIn = true;
    loadPage(authorParam);
  } else if (window.nostr) {
    window.nostr
      .getPublicKey()
      .then(function (pubkey) {
        if (pubkey) {
          loggedIn = true;
          loadPage(pubkey);
        } else {
          logOff();
        }
      })
      .catch((err) => {
        console.log("LoadUser Err", err);
        logOff();
      });
  }
}

function loadPage(author) {
  const urlParams = new URLSearchParams(window.location.search);
  const authorParam = urlParams.get("author");
  const dTag = urlParams.get("id");
  let relay = urlParams.get("relay");

  if (!relay) {
    relay = "wss://nostr.mom";
    urlParams.set("relay", relay);
    history.replaceState(
      null,
      "",
      window.location.pathname + "?" + decodeURIComponent(urlParams.toString())
    );
  }

  console.log("Load page for", relay, author, dTag);

  if (dTag) {
    $("#sheet-name").html(dTag);
    hideDashboard();
    if (authorParam) {
      loadId(relay, authorParam, dTag);
    } else {
      loadId(relay, author, dTag);
    }
  } else {
    showDashboard();
    if (authorParam) {
      loadDashboard(relay, authorParam);
    } else {
      loadDashboard(relay, author);
    }
  }
}

async function hideDashboard() {
  $("#dashboard").hide();
  $("#app-container").show();
}

async function showDashboard() {
  $("#app-container").hide();
  $("#dashboard").show();
}

async function loadDashboard(relay, author) {
  $("#sheets").html("");

  fetchAllSpreadsheets(
    relay,
    author,
    (ee) => {
      console.log("Event Received", ee);

      let currentVersion = expandedEvents.get(ee.address);
      if (currentVersion) {
        if (ee.event.created_at > currentVersion.event.created_at) {
          console.log("New version of ", ee.address);
          expandedEvents.set(ee.address, ee);
          addOrReplaceSheetLine(ee);
        }
      } else {
        console.log("New Sheet", ee.address);
        expandedEvents.set(ee.address, ee);
        addOrReplaceSheetLine(ee);
      }
    },
    (pubkey, metadata) => {
      console.log("New Metatada", pubkey, metadata);
      userNames.set(pubkey, metadata);
      updatePubkeyObservables();
    }
  );
}

function updatePubkeyObservables() {
  console.log("UpdatePubkeyObservables");
  $(".pubkey-observer").each(function () {
    let obj = $(this);
    obj.html(getNameOrShortenKey(obj.attr("id")));
  });
}

function pubkeyObserver(pubkey) {
  return (
    '<a href="?author=' +
    pubkey +
    "\" id='" +
    pubkey +
    "' class='pubkey-observer'>" +
    getNameOrShortenKey(pubkey) +
    "</a>"
  );
}

function addOrReplaceSheetLine(ee) {
  let id = sha256Hex(ee.address);
  if ($(id).length) {
    $(id).remove();
  }

  let deleteButton = "";
  if (ee.canEdit) {
    deleteButton =
      "<button onclick=\"deleteEvent('" +
      ee.address +
      "');event.stopPropagation();\">Delete</button>";
  }

  let teamArray = Array.from(ee.team.values());

  let view = "Public";
  if (!ee.isPublic) {
    view = teamArray
      .filter((it) => it.canView && it.pubkey != ee.event.pubkey)
      .map((it) => pubkeyObserver(it.pubkey))
      .join("");
  }

  $("#sheets").append(
    "<tr id='" +
      id +
      "' onclick=\"document.location.href='?author=" +
      ee.event.pubkey +
      "&id=" +
      ee.dTag +
      "'\">" +
      "<td>" +
      ee.title +
      "</td>" +
      "<td>" +
      pubkeyObserver(ee.event.pubkey) +
      "</td>" +
      "<td>" +
      view +
      "</td>" +
      "<td>" +
      teamArray
        .filter((it) => it.canEdit && it.pubkey != ee.event.pubkey)
        .map((it) => pubkeyObserver(it.pubkey))
        .join("") +
      "</td>" +
      '<td class="right">' +
      formatDate(ee.event.created_at) +
      "</td>" +
      '<td class="center">' +
      deleteButton +
      "</td>" +
      "</tr>"
  );
}

function formatDate(unixtimestamp) {
  let date = new Date(unixtimestamp * 1000);
  return date.toLocaleString();
}

async function deleteEvent(address) {
  let ee = expandedEvents.get(address);
  if (ee) {
    if (window.nostr) {
      await deleteSpreadSheet(ee);
    }
    setTimeout(function () {
      loadUser();
    }, 500);
  }
}

function updateShares() {
  let view = $("#shares-view");
  view.html("");

  if (showingEvent.title) $("#sheet-name").html(showingEvent.title);
  else $("#sheet-name").html(showingEvent.dTag);

  if (showingEvent.isPublic) {
    view.html(" Public");
    $("#public-view").attr("checked", "Checked");
  } else {
    showingEvent.team.forEach((member, key) => {
      if (member.canView) {
        view.append(pubkeyObserver(member.pubkey) + "");
      }
    });
  }

  let edit = $("#shares-edit");
  edit.html("");
  showingEvent.team.forEach((member, key) => {
    if (member.canEdit) {
      edit.append(pubkeyObserver(member.pubkey) + "");
    }
  });
}

function getNameOrShortenKey(pubkey) {
  if (userNames.has(pubkey)) {
    let metadata = userNames.get(pubkey);
    if (metadata.picture) {
      return (
        '<img style="border-radius: 50%;" width="30" height="30" src=\'' +
        metadata.picture +
        "'/>"
      );
    } else if (metadata.display_name) {
      return (
        "<span class='spanAnon'>" +
        metadata.display_name.substring(0, 2) +
        "</span>"
      );
    } else {
      return (
        "<span class='spanAnon'>" + metadata.name.substring(0, 2) + "</span>"
      );
    }
  } else {
    return "<span class='spanAnon'>" + pubkey.substring(0, 2) + "</span>";
  }
}

function shorten(str) {
  return str.substring(0, 6) + ".." + str.substring(str.length - 6, str.length);
}

function addNewViewShare() {
  let newPubKey = npub2hex($("#newPubkeyView").val());

  if (!showingEvent.team.has(newPubKey)) {
    showingEvent.team.set(newPubKey, {
      pubkey: newPubKey,
      canView: true,
      canEdit: false,
    });
  }

  updateShares();

  $("#newPubkeyView").val("");

  saveEvent();
}

function toggleMakeItPublic(newIsPublic) {
  showingEvent.isPublic = newIsPublic;
  updateShares();
  saveEvent();
}

function toggleNameEdit(target) {
  console.log("ToggleNameEdit");
  var title = showingEvent.title;
  $(target).html("");
  $("<input></input>")
    .attr({
      type: "text",
      class: "cool-field",
      id: "txt_title",
      size: "40",
      value: title,
    })
    .on("focusout", function () {
      showingEvent.title = $("#txt_title").val();
      saveEvent();
      $("#sheet-name").text(showingEvent.title);
    })
    .on("click", function (event) {
      event.stopPropagation();
    })
    .appendTo("#sheet-name");
  $("#txt_title").focus();
}

function addNewEditShare() {
  let newPubKey = npub2hex($("#newPubkeyEdit").val());
  showingEvent.team.set(newPubKey, {
    pubkey: newPubKey,
    canView: true,
    canEdit: true,
  });
  updateShares();

  $("#newPubkeyView").val("");

  saveEvent();
}

function saveEvent() {
  const urlParams = new URLSearchParams(window.location.search);
  const author = urlParams.get("author");
  const dTag = urlParams.get("id");

  const activeWorkbook = univerAPI.getActiveWorkbook();
  const saveData = activeWorkbook.getSnapshot();

  try {
    const data = convertUniverToDataArray(saveData);
    saveSpreadSheet(showingEvent, data);
  } catch (e) {
    console.log(e);
  }
}

async function loadId(relay, author, dTag) {
  fetchSpreadSheet(
    relay,
    author,
    dTag,
    (ee, data) => {
      var {
        UniverCore,
        UniverDesign,
        UniverEngineRender,
        UniverEngineFormula,
        UniverDocs,
        UniverDocsUi,
        UniverUi,
        UniverSheets,
        UniverSheetsUi,
        UniverSheetsNumfmt,
        UniverSheetsFormula,
        UniverFacade,
      } = window;

      if (univer) {
        univer.dispose();
        univer = undefined;
      }

      univer = new UniverCore.Univer({
        theme: UniverDesign.defaultTheme,
        locale: UniverCore.LocaleType.EN_US,
        locales: {
          [UniverCore.LocaleType.EN_US]: UniverUMD["en-US"],
        },
      });

      univer.registerPlugin(UniverEngineRender.UniverRenderEnginePlugin);
      univer.registerPlugin(UniverEngineFormula.UniverFormulaEnginePlugin);

      univer.registerPlugin(UniverUi.UniverUIPlugin, {
        container: "app",
        header: true,
        footer: true,
      });

      univer.registerPlugin(UniverDocs.UniverDocsPlugin, {
        hasScroll: false,
      });
      univer.registerPlugin(UniverDocsUi.UniverDocsUIPlugin);

      univer.registerPlugin(UniverSheets.UniverSheetsPlugin);
      univer.registerPlugin(UniverSheetsUi.UniverSheetsUIPlugin);
      univer.registerPlugin(UniverSheetsNumfmt.UniverSheetsNumfmtPlugin);
      univer.registerPlugin(UniverSheetsFormula.UniverSheetsFormulaPlugin);

      univerAPI = UniverFacade.FUniver.newAPI(univer);

      univerAPI.onCommandExecuted((command, options) => {
        // Only synchronize local mutations
        if (
          command.type !== 2 ||
          options?.fromCollab ||
          options?.onlyLocal ||
          command.id === "doc.mutation.rich-text-editing" ||
          command.id === "sheet.mutation.set-worksheet-row-auto-height"
        ) {
          return;
        }

        if (showingEvent.canEdit) {
          const activeWorkbook = univerAPI.getActiveWorkbook();
          const saveData = activeWorkbook.getSnapshot();

          try {
            const data = convertUniverToDataArray(saveData);
            saveSpreadSheet(showingEvent, data);
          } catch (e) {
            console.log(e);
          }
        } else {
          if (!hasWarnedAboutOffline) {
            alert(
              "You are not logged in. Changes to this spreadsheet are not being saved."
            );
            hasWarnedAboutOffline = true;
          }
        }
      });

      console.log("Loading Spreadsheet", ee, data);

      showingEvent = ee;

      updateShares();

      const urlParams = new URLSearchParams(window.location.search);
      const author = urlParams.get("author");
      if (author !== ee.event.pubkey) {
        urlParams.set("author", ee.event.pubkey);
        //window.location.search = urlParams.toString();

        history.replaceState(
          null,
          "",
          window.location.pathname +
            "?" +
            decodeURIComponent(urlParams.toString())
        );
      }

      univer.createUniverSheet(convertDataArrayToUniver(name, data));
    },
    (pubkey, metadata) => {
      console.log("New Metatada", pubkey, metadata);
      userNames.set(pubkey, metadata);
      updatePubkeyObservables();
    }
  );
}
