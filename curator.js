/**
 * =============================================================================
 * DARING DIVAS - CURATOR SCRIPT
 * ... (all your great comments remain the same) ...
 */

// curator.js
require('dotenv').config();
const { Alchemy, Network } = require('alchemy-sdk');
const axios = require('axios');
const Jimp = require('jimp');
const masterHashes = require('./master-hashes.json');
const fs = require('fs');
const path = require('path');

// --- CONFIGURATION ---
const DARING_DIVAS_CONTRACT = '0xD127d434266eBF4CB4F861071ebA50A799A23d9d';
const GIST_ID = process.env.GIST_ID;
// --- THIS IS THE CORRECTED LINE ---
const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const GIST_FILENAME = 'censored-list.json';
const GIST_API_URL = `https://api.github.com/gists/${GIST_ID}`;
const SIMILARITY_THRESHOLD = 5;
const MINTED_IMAGES_DIR = path.join(__dirname, 'minted-images');

// --- HELPER FUNCTION ---
function calculateHammingDistance(hash1, hash2) {
  let distance = 0;
  for (let i = 0; i < hash1.length; i++) {
    if (hash1[i] !== hash2[i]) {
      distance++;
    }
  }
  return distance;
}

async function getCurrentCensoredList() {
    try {
      console.log(`Fetching current censored list from Gist...`);
      const response = await axios.get(GIST_API_URL, {
        headers: { Authorization: `Bearer ${GITHUB_TOKEN}` },
      });
      if (response.data.files[GIST_FILENAME]) {
        const content = response.data.files[GIST_FILENAME].content;
        return JSON.parse(content);
      }
      return {};
    } catch (error) {
      console.error('Could not fetch existing Gist, starting with an empty list.');
      return {};
    }
}

async function runCurator() {
  const alchemy = new Alchemy({
    apiKey: process.env.ALCHEMY_API_KEY,
    network: Network.BASE_MAINNET,
  });

  // The debug block has been removed as it's no longer needed.

  console.log('Starting curator run...');

  if (!fs.existsSync(MINTED_IMAGES_DIR)) {
    fs.mkdirSync(MINTED_IMAGES_DIR);
    console.log(`Created directory: ${MINTED_IMAGES_DIR}`);
  }

  const currentCensoredList = await getCurrentCensoredList();
  console.log(`Found ${Object.keys(currentCensoredList).length} tokens on the old list.`);

  const newCensoredList = {};

  console.log('Fetching all NFTs from the contract to rebuild the list...');
  const allNfts = [];
  for await (const nft of alchemy.nft.getNftsForContractIterator(DARING_DIVAS_CONTRACT)) {
    allNfts.push(nft);
  }
  console.log(`Total NFTs found in collection: ${allNfts.length}. Evaluating all of them...`);

  for (const nft of allNfts) {
    try {
      console.log(`- Evaluating token #${nft.tokenId}...`);
      
      if (!nft.tokenUri) {
        console.log(`  - Skipping token #${nft.tokenId} because it has no tokenUri.`);
        continue;
      }
      const metadataResponse = await axios.get(nft.tokenUri);
      const imageUrl = metadataResponse.data.image;
      if (!imageUrl) {
        console.log(`  - Skipping token #${nft.tokenId} due to missing image URL in live metadata.`);
        continue;
      }

      const image = await Jimp.Jimp.read(imageUrl);
      const newHash = image.pHash();

      const imagePath = path.join(MINTED_IMAGES_DIR, `${nft.tokenId}.jpg`);
      if (!fs.existsSync(imagePath)) {
        await image.write(imagePath);
        console.log(`  💾 Saved new image: ${imagePath}`);
      }

      for (const masterImageName in masterHashes) {
        const masterHash = masterHashes[masterImageName];
        const distance = calculateHammingDistance(newHash, masterHash);

        if (distance <= SIMILARITY_THRESHOLD) {
          console.log(`  ✅ Match found! Similar to '${masterImageName}'. Distance: ${distance}. Adding to new list.`);
          newCensoredList[nft.tokenId] = true;
          break; 
        }
      }
    } catch (error) {
      console.error(`  ❌ Failed to process token #${nft.tokenId}:`, error.message);
    }
  }

  const oldKeys = Object.keys(currentCensoredList).sort();
  const newKeys = Object.keys(newCensoredList).sort();

  if (JSON.stringify(oldKeys) !== JSON.stringify(newKeys)) {
    console.log(`\nList has changed. Old count: ${oldKeys.length}, New count: ${newKeys.length}.`);
    console.log('Updating Gist...');
    await axios.patch(
        GIST_API_URL, 
        { files: { [GIST_FILENAME]: { content: JSON.stringify(newCensoredList, null, 2) } } }, 
        { headers: { Authorization: `Bearer ${GITHUB_TOKEN}`, 'Content-Type': 'application/json' } }
    );
    console.log('Gist updated successfully!');

    if (process.env.GITHUB_OUTPUT) {
      fs.appendFileSync(process.env.GITHUB_OUTPUT, `list_changed=true\n`);
    }

  } else {
    console.log('\nNo changes detected. The censored list is already up to date!');
  }
}

runCurator().then(() => console.log('\nCurator run finished successfully.')).catch((error) => {
  console.error('\n--- A FATAL ERROR OCCURRED ---');
  console.error('Error Message:', error.message);
});

