const { SlashCommandBuilder, EmbedBuilder, PermissionFlagsBits } = require('discord.js');
const fs = require('fs');
const path = require('path');

const dataPath = path.join(__dirname, '../../honeypot-data.json');

let config = {
    honeypotChannelId: null,
    logChannelId: null,
    action: 'kick' // ← Changed default to kick
};

function loadConfig() {
    if (fs.existsSync(dataPath)) {
        try {
            const data = fs.readFileSync(dataPath, 'utf8');
            config = { ...config, ...JSON.parse(data) };
        } catch (err) {
            console.error('Failed to load honeypot config:', err);
        }
    }
}

function saveConfig() {
    try {
        fs.writeFileSync(dataPath, JSON.stringify(config, null, 2));
    } catch (err) {
        console.error('Failed to save honeypot config:', err);
    }
}

loadConfig();

module.exports = {
    data: new SlashCommandBuilder()
        .setName('honeypot-setup')
        .setDescription('Setup or configure the honeypot system')
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
        .addSubcommand(sub =>
            sub
                .setName('create')
                .setDescription('Create the honeypot channel')
                .addRoleOption(opt => opt.setName('admin_role').setDescription('Role that can see the channel').setRequired(false))
        )
        .addSubcommand(sub =>
            sub
                .setName('config')
                .setDescription('Configure honeypot settings')
                .addStringOption(opt =>
                    opt.setName('action')
                        .setDescription('Action to take when triggered')
                        .setChoices(
                            { name: 'Kick', value: 'kick' },
                            { name: 'Ban', value: 'ban' }
                        )
                        .setRequired(false)
                )
                .addChannelOption(opt =>
                    opt.setName('log_channel')
                        .setDescription('Channel to send logs to')
                        .addChannelTypes(0)
                        .setRequired(false)
                )
        ),

    async execute(interaction) {
        const subcommand = interaction.options.getSubcommand();

        if (subcommand === 'create') {
            await handleCreate(interaction);
        } else if (subcommand === 'config') {
            await handleConfig(interaction);
        }
    }
};

async function handleCreate(interaction) {
    await interaction.deferReply();
    const guild = interaction.guild;
    const adminRole = interaction.options.getRole('admin_role');

    let honeypotChannel = config.honeypotChannelId 
        ? guild.channels.cache.get(config.honeypotChannelId) 
        : null;

    if (!honeypotChannel) {
        const overwrites = [
            {
                id: guild.id,
                deny: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages]
            },
            {
                id: guild.client.user.id,
                allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ManageMessages]
            }
        ];

        if (adminRole) {
            overwrites.push({
                id: adminRole.id,
                allow: [PermissionFlagsBits.ViewChannel],
                deny: [PermissionFlagsBits.SendMessages]
            });
        }

        honeypotChannel = await guild.channels.create({
            name: 'honeypot',
            type: 0,
            topic: 'Honeypot trap • DO NOT POST HERE',
            permissionOverwrites: overwrites,
            reason: 'Honeypot anti-raid protection'
        });

        config.honeypotChannelId = honeypotChannel.id;
        saveConfig();

        await interaction.editReply(`✅ **Honeypot channel created:** ${honeypotChannel}\n\nDefault action is now **KICK**.`);
    } else {
        await interaction.editReply(`✅ **Honeypot already exists:** <#${config.honeypotChannelId}>`);
    }
}

async function handleConfig(interaction) {
    await interaction.deferReply({ ephemeral: true });

    const newAction = interaction.options.getString('action');
    const logChannel = interaction.options.getChannel('log_channel');

    if (newAction) {
        config.action = newAction;
        saveConfig();
    }

    if (logChannel) {
        config.logChannelId = logChannel.id;
        saveConfig();
    }

    const embed = new EmbedBuilder()
        .setTitle('🪤 Honeypot Configuration')
        .setColor(0x00ff00)
        .addFields(
            { name: 'Action', value: config.action.toUpperCase(), inline: true },
            { name: 'Honeypot Channel', value: config.honeypotChannelId ? `<#${config.honeypotChannelId}>` : 'Not set', inline: true },
            { name: 'Log Channel', value: config.logChannelId ? `<#${config.logChannelId}>` : 'Not set', inline: true }
        )
        .setTimestamp();

    await interaction.editReply({ embeds: [embed] });
};

// ───── Message Listener (place in your main client or events file) ─────
module.exports.messageListener = async function (message) {
    if (message.author.bot || !message.guild) return;

    if (!config.honeypotChannelId || message.channel.id !== config.honeypotChannelId) return;

    const guild = message.guild;
    const action = config.action || 'kick';
    let logChannel = null;

    if (config.logChannelId) {
        logChannel = guild.channels.cache.get(config.logChannelId);
    }

    try {
        const reason = 'Honeypot trigger: Posted in restricted trap channel';

        if (action === 'ban') {
            await guild.bans.create(message.author, { 
                deleteMessageSeconds: 86400, 
                reason 
            });
        } else {
            await guild.members.kick(message.author, reason);
        }

        const embed = new EmbedBuilder()
            .setTitle('🪤 Honeypot Triggered')
            .setColor(0xff0000)
            .setDescription(`**User:** ${message.author.tag} (${message.author.id})\n**Action:** ${action.toUpperCase()}`)
            .addFields({ name: 'Message', value: message.content?.slice(0, 1024) || '*No content*' })
            .setTimestamp();

        if (logChannel) await logChannel.send({ embeds: [embed] });

        await message.delete().catch(() => {});

    } catch (error) {
        console.error('Honeypot action failed:', error);
        if (logChannel) {
            logChannel.send(`⚠️ Honeypot triggered by ${message.author} but failed to ${action}.`).catch(() => {});
        }
    }
};
