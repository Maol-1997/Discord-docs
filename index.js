import dotenv from 'dotenv'
import {AttachmentBuilder, ChannelType, Client, GatewayIntentBits, Partials, REST, Routes} from 'discord.js'
import fetch from 'node-fetch'

const MAX_RESPONSE_CHUNK_LENGTH = 1500
dotenv.config()

const commands = [
    {
        name: 'ask',
        description: 'Ask me anything about codeGPT!',
        options: [
            {
                name: 'question',
                description: 'Your question',
                type: 3,
                required: true
            }
        ]
    }
]

async function initDiscordCommands() {
    const rest = new REST({version: '10'}).setToken(process.env.DISCORD_BOT_TOKEN)

    try {
        console.log('Started refreshing application (/) commands.')
        await rest.put(Routes.applicationCommands(process.env.DISCORD_CLIENT_ID), {body: commands})
        console.log('Successfully reloaded application (/) commands.')
    } catch (error) {
        console.error(error)
    }
}

async function main() {
    await initDiscordCommands()

    const client = new Client({
        intents: [
            GatewayIntentBits.Guilds,
            GatewayIntentBits.GuildMessages,
            GatewayIntentBits.GuildIntegrations,
            GatewayIntentBits.DirectMessages,
            GatewayIntentBits.DirectMessageTyping,
            GatewayIntentBits.MessageContent
        ],
        partials: [Partials.Channel]
    })

    client.on('ready', () => {
        console.log(`Logged in as ${client.user.tag}!`)
        console.log(new Date())
    })

    function askQuestion({question, interaction = null}, cb) {
        const imageRegex = /https?:\/\/.*\.(?:png|jpg|jpeg|gif)/i
        fetch("https://api.mendable.ai/newConversation", {
            headers: {
                accept: '*/*',
                'content-type': 'application/json'
            },
            body: '{"anon_key":"70685355-6375-445c-a41d-f227c81916e8","messages":[]}',
            method: 'POST'
        }).then(response => response.json()).then((info) => {
            const conversationId = info.conversation_id
            console.log({conversationId})
            const body = {
                question,
                history: [],
                component_version: "0.0.113-beta.4",
                conversation_id: conversationId,
                anon_key: "70685355-6375-445c-a41d-f227c81916e8"
            }
            fetch("https://api.mendable.ai/component/chat", {
                headers: {
                    accept: 'text/event-stream, text/event-stream',
                    'content-type': 'application/json'
                },
                body: JSON.stringify(body),
                method: 'POST'
            }).then(response => response.text()).then(async (response) => {
                console.log({response})
                const splittedResponse = response.trim().split('\n\n')
                splittedResponse.shift()
                splittedResponse.shift()
                splittedResponse.pop()
                let answer = ''
                for (const response of splittedResponse) {
                    const parsedResponse = JSON.parse(response.replace('data: ', ''))
                    answer += parsedResponse.chunk
                }
                if (answer.match(imageRegex)) {
                    const attachments = []
                    const images = answer.match(imageRegex)
                    for (let i = 0; i < images.length; i++) {
                        console.log(images[i])
                        const data = await fetch(images[i]).then(response => response.arrayBuffer())
                        const buffer = Buffer.from(data, 'base64')
                        const imageType = images[i].split('.').pop()
                        const attachment = new AttachmentBuilder(buffer, {name: 'result' + i + '.' + imageType})
                        attachments.push(attachment)
                    }
                    answer = answer.split('\n').filter((line) => !line.match(imageRegex)).join('\n')
                    await interaction.editReply({content: answer, files: attachments})
                    return
                }
                console.log({answer})
                cb(answer)
            }).catch((error) => {
                console.error(error)
                // eslint-disable-next-line n/no-callback-literal
                cb('Error processing your question')
            })
        }).catch((error) => {
            // eslint-disable-next-line n/no-callback-literal
            cb('Error processing your question')
            console.error(error)
        })
    }

    async function splitAndSendResponse(resp, user) {
        while (resp.length > 0) {
            const end = Math.min(MAX_RESPONSE_CHUNK_LENGTH, resp.length)
            await user.send(resp.slice(0, end))
            resp = resp.slice(end, resp.length)
        }
    }

    client.on('messageCreate', async message => {
        if (process.env.ENABLE_DIRECT_MESSAGES !== 'true' || message.channel.type !== ChannelType.DM || message.author.bot) {
            return
        }
        const user = message.author

        console.log('----Direct Message---')
        console.log('Date    : ' + new Date())
        console.log('UserId  : ' + user.id)
        console.log('User    : ' + user.username)
        console.log('Message : ' + message.content)
        console.log('--------------')

        try {
            const sentMessage = await message.reply('Hmm, let me think...')
            askQuestion({question: message.content}, async (response) => {
                if (response.length >= MAX_RESPONSE_CHUNK_LENGTH) {
                    await splitAndSendResponse(response, user)
                } else {
                    await sentMessage.edit(response)
                }
            })
        } catch (e) {
            console.error(e)
        }
    })

    async function handleInteractionAsk(interaction) {
        const question = interaction.options.getString('question')
        try {
            await interaction.reply({content: 'Hmm, let me think...'})
            askQuestion({question, interaction}, async (content) => {
                if (content.length >= MAX_RESPONSE_CHUNK_LENGTH) {
                    await interaction.editReply({content: 'The response is too long, I will send it to you in a DM'})
                    await splitAndSendResponse(content, interaction.user)
                } else {
                    await interaction.editReply({content})
                }
            })
        } catch (e) {
            console.error(e)
        }
    }

    client.on('interactionCreate', async interaction => {
        switch (interaction.commandName) {
            case 'ask':
                await handleInteractionAsk(interaction)
                break
        }
    })

    await client.login(process.env.DISCORD_BOT_TOKEN)
}

main()
