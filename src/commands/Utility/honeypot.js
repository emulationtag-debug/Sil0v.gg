import { SlashCommandBuilder, EmbedBuilder, PermissionFlagsBits } from 'discord.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const dataPath = path.join(__dirname, '../../honeypot-data.json');

let config = {
    honeypotChannelId: null,
    logChannelId: null,
    action: 'kick'
};

function loadConfig() {
    if (fs.existsSync(dataPath)) {
        try {
            config = { ...config, ...JSON.parse(fs.readFileSync(dataPath, 'utf8')) };
        } catch (e) {
            console.error('[Honeypot] Failed to load config', e);
        }
    }
}

function saveConfig() {
    try {
        fs.writeFileSync(dataPath, JSON.stringify(config, null, 2));
    } catch (e) {
        console.error('[Honeypot] Failed to save config', e);
    }
}

loadConfig();

export default {
    data: new SlashCommandBuilder()
        .setName('honeypot-setup')
        .setDescription('Setup or configure the honeypot trap')
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
        .addSubcommand(sub =>
            sub.setName('create')
                .setDescription('Create the hidden honeypot channel')
                .addRoleOption(opt => opt.setName('admin_role').setDescription('Role that can view the channel').setRequired(false))
        )
        .addSubcommand(sub =>
            sub.setName('config')
                .setDescription('Change honeypot settings')
                .addStringOption(opt =>
                    opt.setName('action')
                        .setDescription('Default action')
                        .setChoices(
                            { name: 'Kick', value: 'kick' },
                            { name: 'Ban', value: 'ban' }
                        )
                )
                .addChannelOption(opt =>
                    opt.setName('log_channel')
                        .setDescription('Mod log channel')
                        .addChannelTypes(0)
                )
        ),

    async execute(interaction) {
        if (interaction.options.getSubcommand() === 'create') {
            await handleCreate(interaction);
        } else {
            await handleConfig(interaction);
        }
    }
};

async function handleCreate(interaction) {
    await interaction.deferReply();
    const guild = interaction.guild;
    const adminRole = interaction.options.getRole('admin_role');

    let channel = config.honeypotChannelId ? guild.channels.cache.get(config.honeypotChannelId) : null;

    if (!channel) {
        const overwrites = [
            { id: guild.id, deny: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages] },
            { id: interaction.client.user.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ManageMessages] }
        ];

        if (adminRole) {
            overwrites.push({
                id: adminRole.id,
                allow: [PermissionFlagsBits.ViewChannel],
                deny: [PermissionFlagsBits.SendMessages]
            });
        }

        channel = await guild.channels.create({
            name: 'honeypot',
            type: 0,
            topic: 'Honeypot • DO NOT POST - Instant kick',
            permissionOverwrites: overwrites,
            reason: 'Anti-raid honeypot'
        });

        config.honeypotChannelId = channel.id;
        saveConfig();

        await interaction.editReply(`✅ **Honeypot created:** ${channel}\n\nDefault action: **KICK**`);
    } else {
        await interaction.editReply(`✅ Honeypot already exists: <#${config.honeypotChannelId}>`);
    }
}

async function handleConfig(interaction) {
    await interaction.deferReply({ ephemeral: true });

    const action = interaction.options.getString('action');
    const logChannel = interaction.options.getChannel('log_channel');

    if (action) {
        config.action = action;
        saveConfig();
    }
    if (logChannel) {
        config.logChannelId = logChannel.id;
        saveConfig();
    }

    const embed = new EmbedBuilder()
        .setTitle('🪤 Honeypot Config')
        .setColor(0x00ff00)
        .addFields(
            { name: 'Action', value: config.action.toUpperCase(), inline: true },
            { name: 'Honeypot Channel', value: config.honeypotChannelId ? `<#${config.honeypotChannelId}>` : 'Not set', inline: true },
            { name: 'Log Channel', value: config.logChannelId ? `<#${config.logChannelId}>` : 'Not set', inline: true }
        );

    await interaction.editReply({ embeds: [embed] });
}

// Export listener for messageCreate
export const messageListener = async (message) => {
    if (message.author.bot || !message.guild || !config.honeypotChannelId) return;
    if (message.channel.id !== config.honeypotChannelId) return;

    const guild = message.guild;
    const action = config.action || 'kick';
    let logChannel = config.logChannelId ? guild.channels.cache.get(config.logChannelId) : null;

    try {
        const reason = 'Honeypot trigger: Posted in restricted trap channel';

        if (action === 'ban') {
            await guild.bans.create(message.author, { deleteMessageSeconds: 86400, reason });
        } else {
            await guild.members.kick(message.author, reason);
        }

        const embed = new EmbedBuilder()
            .setTitle('🪤 Honeypot Triggered')
            .setColor(0xff0000)
            .setDescription(`**User:** ${message.author.tag} (${message.author.id})\n**Action:** ${action.toUpperCase()}`)
            .addFields({ name: 'Content', value: message.content?.slice(0, 1024) || '*None*' })
            .setTimestamp();

        if (logChannel) await logChannel.send({ embeds: [embed] });
        await message.delete().catch(() => {});

    } catch (err) {
        console.error('[Honeypot] Error:', err);
        if (logChannel) logChannel.send(`⚠️ Honeypot failed for ${message.author}`).catch(() => {});
    }
};
