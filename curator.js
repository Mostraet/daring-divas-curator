/**
 * =============================================================================
 * DARING DIVAS - CURATOR SCRIPT
 * =============================================================================
 *
 * PURPOSE:
 * This script is the automated back-end curator for the Daring Divas project.
 * Its primary function is to analyze every NFT in the collection and determine
 * which ones are considered NSFW based on visual similarity to a set of master
 * images. It then generates and uploads a `censored-list.json` file to a
 * GitHub Gist, which the front-end application uses to enable the de-censor
 * feature for holders.
 *
 * ---
 *
 * HOW IT WORKS:
 * 1.  **Initialization**: The script loads a set of pre-generated perceptual
 *     hashes from `master-hashes.json`. These hashes represent the "master"
 *     NSFW images.
 * 2.  **Fetch All NFTs**: It connects to the blockchain via Alchemy and iterates
 *     through every single NFT in the Daring Divas contract.
 * 3.  **Rebuild from Scratch**: On every run, it starts with a blank list. It
 *     does not modify the old list; it creates a new one every time to ensure
 *     additions and removals are handled correctly.
 * 4.  **Live Metadata Fetch**: For each NFT, it fetches the live metadata from
 *     its `tokenUri` to ensure it's analyzing the most up-to-date, revealed
 *     artwork, not a cached or placeholder image.
 * 5.  **Perceptual Hashing**: Using the `jimp` library, it calculates a
 *     perceptual hash (`pHash`) for each NFT's image.
 * 6.  **Similarity Check**: It compares the newly generated hash against every
 *     hash in the `master-hashes.json` file by calculating the Hamming distance.
 * 7.  **Censorship Criteria**: If the Hamming distance is less than or equal to
 *     the `SIMILARITY_THRESHOLD`, the card is considered a match and its
 *     token ID is added to the new censored list.
 * 8.  **Local Caching**: As a secondary function, if an NFT's image is not
 *     already present in the `./minted-images` directory, it is downloaded
 *     and saved. This is useful for local record-keeping.
 * 9.  **Gist Update**: After processing all NFTs, the script compares the newly
 *     generated list with the previous list from the Gist. If there are any
 *     changes, it overwrites the Gist with the new list.
 *
 * ---
 *
 * HOW TO ADD NEW NSFW CARDS TO THE DETECTION POOL:
 *
 * To teach the curator to recognize a new set of NSFW cards, you need to update
 * the master hash list. This is a two-step process:
 *
 * 1.  **Update Master Images**:
 *     - Place a high-quality example of the new NSFW card's artwork into the
 *       `./master-images` directory. The file can be a JPG or PNG.
 *
 * 2.  **Regenerate Master Hashes**:
 *     - You must run the separate hash generation script (e.g.,
 *       `generate-master-hashes.js`) to update the `master-hashes.json` file.
 *       This script will scan the `./master-images` directory and create new
 *       perceptual hashes for all images found there, overwriting the old JSON file.
 *
 * Once `master-hashes.json` is updated, the next run of this curator script
 * will automatically use the new master hash to find all matching cards in the
 * entire collection and update the `censored-list.json` accordingly.
 * 
 * REMEMBER TO ADD ANY NEW IMAGES TO THE UNCENSORED POOL AS WELL!
 *
 * Open the daring-divas-reveal project folder on your computer, go to public/uncensored folder
 * Add all your uncensored JPG image files into this newly created uncensored folder.
 * As soon as they are revealed, rename them to the tokenID, e.g. 17.jpg
 *
 */

// curator.js
require('dotenv').config();
const { Alchemy, Network } = require('alchemy-sdk');
const axios = require('axios');
const Jimp = require('jimp');
const masterHashes = require('./master-hashes.json');
const fs = require('fs'); // For file system operations
const path = require('path'); // For handling file paths

// --- CONFIGURATION ---
const DARING_DIVAS_CONTRACT = '0xD127d434266eBF4CB4F861071ebA50A799A23d9d';
const GIST_ID = process.env.GIST_ID;
const GITHUB_TOKEN = process.env.GIST_ACCESS_TOKEN;
const GIST_FILENAME = 'censored-list.json';
const GIST_API_URL = `https://api.github.com/gists/${GIST_ID}`;
const SIMILARITY_THRESHOLD = 5;
const MINTED_IMAGES_DIR = path.join(__dirname, 'minted-images'); // Define images directory

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

  console.log('Starting curator run...');

  // --- ADDED: Ensure the minted-images directory exists ---
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

      // --- ADDED: Save the image if it's not already saved ---
      const imagePath = path.join(MINTED_IMAGES_DIR, `${nft.tokenId}.jpg`);
      if (!fs.existsSync(imagePath)) {
        await image.write(imagePath); // Corrected to use .write()
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
  } else {
    console.log('\nNo changes detected. The censored list is already up to date!');
  }
}

runCurator().then(() => console.log('\nCurator run finished successfully.')).catch((error) => {
  console.error('\n--- A FATAL ERROR OCCURRED ---');
  console.error('Error Message:', error.message);
});

