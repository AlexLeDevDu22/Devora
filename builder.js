const fetch = require("node-fetch");
const fs = require("fs");
const path = require("path");

var history = [];
async function LLMPrompt(prompt, isCode = false) {
  history.push({ role: "user", content: prompt });
  const response = await fetch("http://localhost:11434/api/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "phi3",
      messages: history,
      stream: false,
    }),
  });
  if (!response.ok) {
    throw new Error(`Error: ${res.error}`);
  }
  let res = await response.json();
  if (res.error) {
    throw new Error(`Error: ${res.error}`);
  }
  res = res.message.content;
  if (isCode) {
    const match = res.match(/```(?:\w+\n)?([\s\S]*?)```/); // capture tout le bloc de code proprement
    res = match ? match[1].trim() : res.trim(); // sinon on garde brut
  }
  history.push({ role: "assistant", content: res });

  return res;
}

async function generateMissedInfos(input) {
  if (
    input.general.stack.frontend &&
    input.general.stack.backend &&
    input.general.stack.database &&
    input.general.mainFeatures &&
    input.design.colorPalette.primary &&
    input.design.colorPalette.secondary &&
    input.design.colorPalette.tertiary
  )
    return input;

  let infos = {
    stack: input.general.stack,
    mainFeatures: input.general.mainFeatures,
    colorPalette: input.design.colorPalette,
  };

  const prompt =
    "Maintenant tu vas me commencer le projet en remplissant les infos essentiel pour son dévelopement, redonne moi juste la json complété, si on demande des stacks, tu peux mettre null si tu estime qu'elle n'est pas necessaire: " +
    stringify(infos);

  const response = JSON.parse(await LLMPrompt(prompt, true));

  input.general.stack.frontend = response.stack.frontend;
  input.general.stack.backend = response.stack.backend;
  input.general.stack.database = response.stack.database;
  input.general.mainFeatures = response.mainFeatures;
  input.design.colorPalette.primary = response.colorPalette.primary;
  input.design.colorPalette.secondary = response.colorPalette.secondary;
  input.design.colorPalette.tertiary = response.colorPalette.tertiary;

  return input;
}

async function generateStructure(input) {
  const prompt = `À partir de ce JSON décrivant un projet, génère une structure de fichiers et dossiers optimisée pour le développement. Retourne uniquement un JSON valide sans commentaires. Je ne veux pas de reponse textuel ni de boujour, ni rien d'autre, soit toujours bref dans toutes tes prochaines résponses.

    ${JSON.stringify(input, null, 2)}

    Réponds uniquement avec un JSON ayant cette forme :
    {
        "name": "Nom du projet",
        "type": "folder",
        "children": [
            { "name": "fichierOuDossier", "type": "file|folder", "children": [...], "contents": [description elem 1, description elem 2, ...] },
        ]
    }
    Pour chaque fichiers de prog(html, css, js, php, jsx, etc), je veux que tu me donne les differentes parties du code/d'élements pour diviser chaques fichiers (tu y donne une description assez précise pour bien le coder)
    `;
  const structure = require("./example/example-response1.json");
  //JSON.parse(await LLMPrompt(prompt), true);

  function getUniqueFolderName(baseDir, projectName) {
    let timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    let folderPath = `${timestamp}_${projectName.replace(" ", "_")}`;

    let counter = 1;
    while (fs.existsSync(folderPath)) {
      folderPath = `${timestamp}_${projectName.replace(" ", "_")}_${counter}`;
      counter++;
    }

    return folderPath;
  }
  const projectFolder = getUniqueFolderName("Building", input.general.name);

  structure.name = projectFolder;

  // 3. Générer les fichiers et dossiers
  function saveStructure(basePath, structure) {
    const targetPath = path.join(basePath, structure.name);

    if (structure.type === "folder") {
      if (!fs.existsSync(targetPath)) {
        fs.mkdirSync(targetPath, { recursive: true });
      }

      if (structure.children && structure.children.length > 0) {
        structure.children.forEach((child) => saveStructure(targetPath, child));
      }
    } else if (structure.type === "file") {
      if (!fs.existsSync(targetPath)) {
        fs.writeFileSync(targetPath, ``);
      }
    }
  }
  saveStructure("Building", structure);

  console.log(`Projet généré dans : ${projectFolder}`);

  return projectFolder, structure;
}

function generateTodo(input, structure) {
  const prompts = [];

  const fileExtensions = ["js", "jsx", "html", "css", "ts", "tsx", "php"];

  const isCodeFile = (fileName) => {
    const ext = path.extname(fileName).replace(".", "");
    return fileExtensions.includes(ext);
  };

  const traverse = (node, basePath) => {
    const fullPath = path.join(basePath, node.name);

    if (node.type === "file" && isCodeFile(node.name)) {
      const ext = path.extname(node.name);

      // Génère un prompt pour chaque section de contenu individuellement
      const parts = (node.contents || []).map((desc, i) => {
        const prompt = `Tu vas coder une PARTIE du fichier ${
          basePath + "/" + node.name
        } (${ext}).
Voici la description de cette partie (${i + 1}):
- ${desc}

Le fichier complet doit être assemblé à partir de plusieurs parties comme celle-ci. Fais en sorte que cette partie puisse être concaténée avec les autres sans erreur de syntaxe.

Contexte du projet :
- Nom : ${input.general.name}
- Description : ${input.general.quickDescription}
- Type : ${input.general.type}
- Public cible : ${input.general.usersTargeted}
- Slogan : ${input.general.slogan}
- Stack : Frontend=${input.general.stack.frontend}, Backend=${
          input.general.stack.backend
        }, DB=${input.general.stack.database}
- Design : couleurs (${Object.values(input.design.colorPalette).join(
          ", "
        )}), typographies (${Object.values(input.design.typography).join(", ")})

Règles :
- Code lisible et modulaire
- Cette partie doit être autonome mais intégrable dans le fichier complet
- Pas de doublon de code global comme <!DOCTYPE> ou import React si déjà fait ailleurs
- Pas de lorem ipsum
- Respecte le style global du projet
- Réponds uniquement avec le code final.
- Ne mets pas d'explication, pas de commentaire.
- Ne parle pas. Encadre le code avec des balises triple backticks si tu veux, mais rien d'autre.
`;
        return {
          filePath: fullPath,
          partIndex: i + 1,
          totalParts: node.contents.length,
          prompt,
        };
      });

      prompts.push(...parts);
    } else if (node.type === "folder" && node.children) {
      node.children.forEach((child) => traverse(child, fullPath));
    }
  };

  traverse(structure, "");

  return prompts;
}

async function codeGeneration(todo) {
  for (const { filePath, prompt, partIndex, totalParts } of todo) {
    // console.log(`Prompt : ${prompt}`);
    console.log(`\nFichier : ${filePath}`);
    const response = await LLMPrompt(prompt, true);
    if (partIndex === 1) {
      fs.writeFileSync("Building/" + filePath, response);
    } else {
      const content = fs.readFileSync("Building/" + filePath, "utf-8");
      const newContent =
        content + (content.endsWith("\n") ? "" : "\n") + response;
      fs.writeFileSync("Building/" + filePath, newContent);
    }
  }
}

async function main() {
  let input = await generateMissedInfos(
    require("./example/example-input.json")
  );
  const structure = await generateStructure(input);
  const todo = generateTodo(input, structure);
  await codeGeneration(todo);
}

main();
