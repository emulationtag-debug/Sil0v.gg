import { SlashCommandBuilder, EmbedBuilder, PermissionsBitField, ChannelType } from 'discord.js';
import { getColor } from '../../../config/bot.js';
import { createEmbed, errorEmbed, successEmbed } from '../../../utils/embeds.js';
import { getGuildConfig, setGuildConfig } from '../../../services/guildConfig.js';
import { InteractionHelper } from '../../../utils/interactionHelper.js';
import { logger } from '../../../utils/logger.js';

export default {
    data: new SlashCommandBuilder()
        .setName('honeypot')
        .setDescription('Manage the honeypot trap system')
        .setDefaultMemberPermissions(PermissionsBitField.Flags.Administrator)
        .addSubcommand(sub =>
            sub
                .setName('setup')
                .setDescription('Create the hidden honeypot channel')
                .addRoleOption(opt => opt.setName('admin_role').setDescription('Role that can view the channel').setRequired(false))
        )
        .addSubcommand(sub =>
            sub
                .setName('config')
                .setDescription('Configure honeypot settings')
                .addStringOption(opt =>
                    opt.setName('action')
                        .setDescription('Action when triggered')
                        .setChoices(
                            { name: 'Kick', value: 'kick' },
                            { name: 'Ban', value: 'ban' }
                        )
                )
                .addChannelOption(opt =>
                    opt.setName('log_channel')
                        .setDescription('Log channel for honeypot triggers')
                        .addChannelTypes(ChannelType.GuildText)
                )
        ),

    async execute(interaction, config, client) {
        const subcommand = interaction.options.getSubcommand();

        if (subcommand === 'setup') {
            await handleSetup(interaction, client);
        } else if (subcommand === 'config') {
            await handleConfig(interaction, client);
        }
    }
};

async function handleSetup(interaction, client) {
    await InteractionHelper.safeDefer(interaction);

    const guild = interaction.guild;
    const adminRole = interaction.options.getRole('admin_role');
    const guildConfig = await getGuildConfig(client, guild.id);

    if (guildConfig.honeypotChannelId) {
        const existing = guild.channels.cache.get(guildConfig.honeypotChannelId);
        if (existing) {
            return InteractionHelper.safeEditReply(interaction, {
                embeds: [successEmbed('Honeypot Exists', `Honeypot is already set up: ${existing}`)]
            });
        }
    }

    try {
        const overwrites = [
            {
                id: guild.id,
                deny: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages]
            },
            {
                id: client.user.id,
                allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages, PermissionsBitField.Flags.ManageMessages]
            }
        ];

        if (adminRole) {
            overwrites.push({
                id: adminRole.id,
                allow: [PermissionsBitField.Flags.ViewChannel],
                deny: [PermissionsBitField.Flags.SendMessages]
            });
        }

        const honeypotChannel = await guild.channels.create({
            name: 'honeypot',
            type: ChannelType.GuildText,
            topic: 'Honeypot Trap • DO NOT POST HERE - Instant Action',
            permissionOverwrites: overwrites,
            reason: 'Anti-raid honeypot system'
        });

        guildConfig.honeypotChannelId = honeypotChannel.id;
        await setGuildConfig(client, guild.id, guildConfig);

        await InteractionHelper.safeEditReply(interaction, {
            embeds: [successEmbed('✅ Honeypot Created', `${honeypotChannel}\n\nDefault action: **KICK**`)]
        });

        logger.info('Honeypot channel created', { guildId: guild.id, channelId: honeypotChannel.id });

    } catch (error) {
        logger.error('Honeypot setup error:', error);
        await handleInteractionError(interaction, error, { commandName: 'honeypot setup' });
    }
}

async function handleConfig(interaction, client) {
    await InteractionHelper.safeDefer(interaction, { ephemeral: true });

    const action = interaction.options.getString('action');
    const logChannel = interaction.options.getChannel('log_channel');
    const guildConfig = await getGuildConfig(client, interaction.guildId);

    if (action) {
        guildConfig.honeypotAction = action;
        await setGuildConfig(client, interaction.guildId, guildConfig);
    }

    if (logChannel) {
        guildConfig.honeypotLogChannelId = logChannel.id;
        await setGuildConfig(client, interaction.guildId, guildConfig);
    }

    const embed = createEmbed({
        title: '🪤 Honeypot Configuration',
        description: `**Action:** ${guildConfig.honeypotAction?.toUpperCase() || 'KICK'}\n` +
                     `**Honeypot Channel:** ${guildConfig.honeypotChannelId ? `<#${guildConfig.honeypotChannelId}>` : 'Not set'}\n` +
                     `**Log Channel:** ${guildConfig.honeypotLogChannelId ? `<#${guildConfig.honeypotLogChannelId}>` : 'Not set'}`
    }).setColor(getColor('success'));

    await InteractionHelper.safeEditReply(interaction, { embeds: [embed] });
}
